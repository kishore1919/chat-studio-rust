use crate::config::McpTransport;
use futures_util::{pin_mut, StreamExt};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::process::Stdio;
use std::str::FromStr;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time::timeout;

const PROTOCOL_VERSION: &str = "2024-11-05";
const CLIENT_NAME: &str = "chat-studio";
const CLIENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const INIT_TIMEOUT: Duration = Duration::from_secs(10);
const LIST_TOOLS_TIMEOUT: Duration = Duration::from_secs(10);
const CALL_TOOL_TIMEOUT: Duration = Duration::from_secs(60);
/// Cap on the restart-cooldown backoff for a server that keeps failing to
/// spawn or initialize - without a cap, a persistently broken server config
/// would still be retried instantly on every tool-list refresh.
const MAX_RESTART_BACKOFF: Duration = Duration::from_secs(30);
const INITIAL_RESTART_BACKOFF: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTool {
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "inputSchema")]
    pub input_schema: serde_json::Value,
    #[serde(default)]
    pub server_id: String,
    #[serde(default)]
    pub server_name: String,
}

fn create_command(command: &str, args: &[String], env: &BTreeMap<String, String>) -> Command {
    let mut cmd = Command::new(command);
    cmd.args(args);
    for (k, v) in env {
        cmd.env(k, v);
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        // Piped rather than null: a server that fails to start almost always
        // says why on stderr, and silently discarding that (the old
        // behavior) left a failed connection with no explanation anywhere.
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW (0x08000000) prevents a console popup on Windows.
        cmd.creation_flags(0x08000000);
    }

    cmd
}

/// Parses an HTTP response body that may contain one JSON-RPC object or a
/// newline-delimited sequence of objects. Returns the array of values.
fn parse_jsonl_or_single(body: &str) -> Result<Vec<Value>, String> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let mut values = Vec::new();
    for line in trimmed.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        values.push(serde_json::from_str(line).map_err(|e| format!("invalid JSON-RPC line: {e}"))?);
    }
    Ok(values)
}

fn build_http_headers(extra: &BTreeMap<String, String>) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    for (k, v) in extra {
        let name = HeaderName::from_str(k).map_err(|e| format!("bad header name '{k}': {e}"))?;
        let value =
            HeaderValue::from_str(v).map_err(|e| format!("bad header value for '{k}': {e}"))?;
        headers.insert(name, value);
    }
    Ok(headers)
}

/// Formats a `tools/call` result's `content` array into plain text for
/// display - MCP tool results are a list of content blocks (usually text),
/// not a single string.
fn format_tool_result(result: &Value) -> String {
    if let Some(content) = result.get("content").and_then(|c| c.as_array()) {
        let mut out = String::new();
        for item in content {
            if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                if !out.is_empty() {
                    out.push('\n');
                }
                out.push_str(text);
            } else {
                out.push_str(&item.to_string());
            }
        }
        return out;
    }
    if result.is_null() {
        return "Tool executed successfully with empty result.".into();
    }
    result.to_string()
}

/// A single long-lived MCP server connection over stdio. Replies are matched
/// to requests by JSON-RPC `id` via a table of one-shot channels, rather than
/// by read order - a server that writes a log line, a progress notification,
/// or anything else unsolicited to stdout no longer permanently desyncs the
/// client the way the old "read the next line and assume it's your answer"
/// approach did.
struct McpSession {
    transport: McpTransport,
    pending: Arc<Mutex<HashMap<i64, oneshot::Sender<Value>>>>,
    next_id: AtomicI64,
    // Stdio transport state.
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    // HTTP streamable-transport state.
    http: Option<reqwest::Client>,
    base_url: String,
    headers: HeaderMap,
    session_id: Mutex<Option<String>>,
}

impl McpSession {
    async fn spawn_stdio(
        server_id: &str,
        command: &str,
        args: &[String],
        env: &BTreeMap<String, String>,
    ) -> Result<Self, String> {
        let mut child = create_command(command, args, env)
            .spawn()
            .map_err(|e| format!("failed to spawn MCP server '{command}': {e}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "failed to open stdin for MCP server".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "failed to open stdout for MCP server".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "failed to open stderr for MCP server".to_string())?;

        let pending: Arc<Mutex<HashMap<i64, oneshot::Sender<Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let pending_for_reader = pending.clone();
        let id_for_reader = server_id.to_string();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        if line.trim().is_empty() {
                            continue;
                        }
                        let Ok(value) = serde_json::from_str::<Value>(&line) else {
                            tracing::debug!(server_id = %id_for_reader, line, "unparseable MCP stdout line");
                            continue;
                        };
                        let Some(msg_id) = value.get("id").and_then(|v| v.as_i64()) else {
                            // A notification, or a request from the server (unsupported
                            // client-side); neither has a waiting reply channel.
                            tracing::debug!(server_id = %id_for_reader, %value, "MCP message with no request id");
                            continue;
                        };
                        let sender = pending_for_reader.lock().await.remove(&msg_id);
                        match sender {
                            Some(tx) => {
                                let _ = tx.send(value);
                            }
                            None => {
                                tracing::debug!(server_id = %id_for_reader, id = msg_id, "MCP response with no waiting request");
                            }
                        }
                    }
                    Ok(None) => break, // stdout closed - the process exited
                    Err(e) => {
                        tracing::warn!(server_id = %id_for_reader, error = %e, "MCP stdout read error");
                        break;
                    }
                }
            }
        });

        let id_for_stderr = server_id.to_string();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::warn!(server_id = %id_for_stderr, "mcp stderr: {line}");
            }
        });

        Ok(Self {
            transport: McpTransport::Stdio,
            pending,
            next_id: AtomicI64::new(1),
            stdin: Mutex::new(Some(stdin)),
            child: Mutex::new(Some(child)),
            http: None,
            base_url: String::new(),
            headers: HeaderMap::new(),
            session_id: Mutex::new(None),
        })
    }

    async fn spawn_http(
        http: reqwest::Client,
        base_url: String,
        headers: HeaderMap,
    ) -> Result<Self, String> {
        let pending: Arc<Mutex<HashMap<i64, oneshot::Sender<Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        // Streamable HTTP uses one long-lived SSE stream for server->client
        // messages, plus short POSTs for client->server requests.
        let (event_tx, mut event_rx) = mpsc::unbounded_channel::<String>();
        let base_url_for_stream = base_url.clone();
        let headers_for_stream = headers.clone();
        let http_for_stream = http.clone();
        tokio::spawn(async move {
            loop {
                let mut request = http_for_stream
                    .get(&base_url_for_stream)
                    .header("Accept", "text/event-stream");
                for (k, v) in &headers_for_stream {
                    request = request.header(k, v);
                }
                let stream = match request.send().await {
                    Ok(r) => r.bytes_stream(),
                    Err(e) => {
                        tracing::warn!(error = %e, "MCP HTTP GET stream failed; reconnecting");
                        tokio::time::sleep(Duration::from_secs(1)).await;
                        continue;
                    }
                };
                pin_mut!(stream);
                let mut buf = String::new();
                while let Some(chunk) = stream.next().await {
                    match chunk {
                        Ok(bytes) => {
                            buf.push_str(&String::from_utf8_lossy(&bytes));
                            while let Some(pos) = buf.find('\n') {
                                let line = buf.split_off(pos + 1);
                                let mut current = std::mem::replace(&mut buf, line);
                                current.truncate(current.len().saturating_sub(1));
                                let _ = event_tx.send(current);
                            }
                        }
                        Err(e) => {
                            tracing::warn!(error = %e, "MCP HTTP stream chunk error; reconnecting");
                            break;
                        }
                    }
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        });

        let pending_for_reader = pending.clone();
        tokio::spawn(async move {
            while let Some(raw) = event_rx.recv().await {
                let line = raw.trim();
                if line.is_empty() {
                    continue;
                }
                let value = match serde_json::from_str::<Value>(line) {
                    Ok(v) => v,
                    Err(e) => {
                        tracing::debug!(line, error = %e, "unparseable MCP HTTP event");
                        continue;
                    }
                };
                let Some(msg_id) = value.get("id").and_then(|v| v.as_i64()) else {
                    // Notifications or server requests don't have a waiting reply.
                    tracing::debug!(%value, "MCP HTTP message with no request id");
                    continue;
                };
                let sender = pending_for_reader.lock().await.remove(&msg_id);
                if let Some(tx) = sender {
                    let _ = tx.send(value);
                }
            }
        });

        Ok(Self {
            transport: McpTransport::Http,
            pending,
            next_id: AtomicI64::new(1),
            stdin: Mutex::new(None),
            child: Mutex::new(None),
            http: Some(http),
            base_url,
            headers,
            session_id: Mutex::new(None),
        })
    }

    #[allow(clippy::too_many_arguments)]
    async fn spawn(
        http: Option<reqwest::Client>,
        server_id: &str,
        transport: McpTransport,
        command: &str,
        args: &[String],
        env: &BTreeMap<String, String>,
        url: &str,
        headers: &BTreeMap<String, String>,
    ) -> Result<Self, String> {
        match transport {
            McpTransport::Stdio => Self::spawn_stdio(server_id, command, args, env).await,
            McpTransport::Http => {
                let http = http.ok_or_else(|| "HTTP MCP requires a reqwest client".to_string())?;
                let headers = build_http_headers(headers)?;
                Self::spawn_http(http, url.to_string(), headers).await
            }
        }
    }

    async fn write_stdio(&self, payload: &str) -> Result<(), String> {
        let mut stdin = self.stdin.lock().await;
        let Some(stdin) = stdin.as_mut() else {
            return Err("stdio MCP session has no stdin handle".into());
        };
        stdin
            .write_all(payload.as_bytes())
            .await
            .map_err(|e| format!("failed to write to MCP server: {e}"))?;
        stdin
            .flush()
            .await
            .map_err(|e| format!("failed to flush MCP server stdin: {e}"))
    }

    async fn post_http(&self, body: Value) -> Result<Vec<Value>, String> {
        let http = self
            .http
            .as_ref()
            .ok_or_else(|| "HTTP MCP session has no HTTP client".to_string())?;
        let mut request = http
            .post(&self.base_url)
            .header("Accept", "application/json, text/event-stream")
            .json(&body);
        for (k, v) in &self.headers {
            request = request.header(k, v);
        }
        let session_id = self.session_id.lock().await.clone();
        if let Some(sid) = session_id {
            request = request.header("Mcp-Session-Id", sid);
        }
        let response = request
            .send()
            .await
            .map_err(|e| format!("MCP HTTP POST failed: {e}"))?;
        let status = response.status();
        let headers = response.headers().clone();
        let body_text = response
            .text()
            .await
            .map_err(|e| format!("MCP HTTP response body error: {e}"))?;
        if let Some(sid) = headers.get("Mcp-Session-Id").and_then(|v| v.to_str().ok()) {
            *self.session_id.lock().await = Some(sid.to_string());
        }
        if !status.is_success() {
            return Err(format!("MCP HTTP POST returned {status}: {body_text}"));
        }
        parse_jsonl_or_single(&body_text)
    }

    async fn request(
        &self,
        method: &str,
        params: Value,
        timeout_dur: Duration,
    ) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);

        let req = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });

        let send_result = match self.transport {
            McpTransport::Stdio => {
                let mut line = serde_json::to_string(&req).map_err(|e| e.to_string())?;
                line.push('\n');
                self.write_stdio(&line).await
            }
            McpTransport::Http => {
                // For HTTP we still need to receive the response via the SSE
                // stream so the id-based routing works identically to stdio.
                // The POST may return a 202 Accepted with an empty body; the
                // actual JSON-RPC reply arrives on the GET stream.
                match self.post_http(req).await {
                    Ok(values) => {
                        for value in values {
                            let Some(msg_id) = value.get("id").and_then(|v| v.as_i64()) else {
                                continue;
                            };
                            let sender = self.pending.lock().await.remove(&msg_id);
                            if let Some(tx) = sender {
                                let _ = tx.send(value);
                            }
                        }
                        Ok(())
                    }
                    Err(e) => Err(e),
                }
            }
        };

        if let Err(e) = send_result {
            self.pending.lock().await.remove(&id);
            return Err(e);
        }

        let response = match timeout(timeout_dur, rx).await {
            Ok(Ok(value)) => value,
            Ok(Err(_)) => {
                self.pending.lock().await.remove(&id);
                return Err("MCP session closed before responding".into());
            }
            Err(_) => {
                self.pending.lock().await.remove(&id);
                return Err(format!("timed out waiting for MCP '{method}' response"));
            }
        };

        if let Some(err) = response.get("error") {
            return Err(err.to_string());
        }
        Ok(response.get("result").cloned().unwrap_or(Value::Null))
    }

    async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let notif = json!({ "jsonrpc": "2.0", "method": method, "params": params });
        match self.transport {
            McpTransport::Stdio => {
                let mut line = serde_json::to_string(&notif).map_err(|e| e.to_string())?;
                line.push('\n');
                self.write_stdio(&line).await
            }
            McpTransport::Http => {
                // Notifications over streamable HTTP are fire-and-forget POSTs.
                let _ = self.post_http(notif).await?;
                Ok(())
            }
        }
    }

    async fn initialize(&self) -> Result<(), String> {
        self.request(
            "initialize",
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": { "name": CLIENT_NAME, "version": CLIENT_VERSION }
            }),
            INIT_TIMEOUT,
        )
        .await?;
        self.notify("notifications/initialized", json!({})).await
    }

    async fn is_alive(&self) -> bool {
        match self.transport {
            McpTransport::Stdio => {
                if let Some(child) = self.child.lock().await.as_mut() {
                    matches!(child.try_wait(), Ok(None))
                } else {
                    false
                }
            }
            McpTransport::Http => true, // Long-lived SSE stream; reconnection is automatic.
        }
    }

    async fn shutdown(&self) {
        if let Some(child) = self.child.lock().await.as_mut() {
            let _ = child.kill().await;
        }
    }
}

struct Cooldown {
    retry_after: Instant,
    next_backoff: Duration,
}

/// Owns one persistent [`McpSession`] per configured server, spawned lazily
/// on first use rather than per-operation. The old per-call spawn-then-kill
/// approach paid a process cold start on every single tool list refresh and
/// could never support a genuinely stateful server.
pub struct McpManager {
    sessions: Mutex<HashMap<String, Arc<McpSession>>>,
    cooldowns: Mutex<HashMap<String, Cooldown>>,
}

impl Default for McpManager {
    fn default() -> Self {
        Self::new()
    }
}

impl McpManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            cooldowns: Mutex::new(HashMap::new()),
        }
    }

    /// Returns a live session for the server, spawning it on first use and
    /// respawning it if the previous process has since exited. A server that
    /// just failed to spawn or initialize is put on an exponentially
    /// increasing cooldown (capped at `MAX_RESTART_BACKOFF`) rather than
    /// retried instantly on every call.
    #[allow(clippy::too_many_arguments)]
    async fn get_or_spawn(
        &self,
        http: Option<reqwest::Client>,
        server_id: &str,
        transport: McpTransport,
        command: &str,
        args: &[String],
        env: &BTreeMap<String, String>,
        url: &str,
        headers: &BTreeMap<String, String>,
    ) -> Result<Arc<McpSession>, String> {
        if let Some(existing) = self.sessions.lock().await.get(server_id) {
            if existing.is_alive().await {
                return Ok(existing.clone());
            }
        }
        // Either never spawned or the process died - drop the stale entry
        // before attempting a respawn.
        self.sessions.lock().await.remove(server_id);

        {
            let cooldowns = self.cooldowns.lock().await;
            if let Some(cooldown) = cooldowns.get(server_id) {
                if Instant::now() < cooldown.retry_after {
                    return Err(format!(
                        "MCP server '{server_id}' recently failed and is on cooldown - try again shortly"
                    ));
                }
            }
        }

        match McpSession::spawn(http, server_id, transport, command, args, env, url, headers).await
        {
            Ok(session) => {
                if let Err(e) = session.initialize().await {
                    session.shutdown().await;
                    self.record_failure(server_id).await;
                    return Err(e);
                }
                let session = Arc::new(session);
                self.sessions
                    .lock()
                    .await
                    .insert(server_id.to_string(), session.clone());
                self.cooldowns.lock().await.remove(server_id);
                Ok(session)
            }
            Err(e) => {
                self.record_failure(server_id).await;
                Err(e)
            }
        }
    }

    async fn record_failure(&self, server_id: &str) {
        let mut cooldowns = self.cooldowns.lock().await;
        let next_backoff = cooldowns
            .get(server_id)
            .map(|c| (c.next_backoff * 2).min(MAX_RESTART_BACKOFF))
            .unwrap_or(INITIAL_RESTART_BACKOFF);
        cooldowns.insert(
            server_id.to_string(),
            Cooldown {
                retry_after: Instant::now() + next_backoff,
                next_backoff,
            },
        );
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn list_tools(
        &self,
        http: Option<reqwest::Client>,
        server_id: &str,
        server_name: &str,
        transport: McpTransport,
        command: &str,
        args: &[String],
        env: &BTreeMap<String, String>,
        url: &str,
        headers: &BTreeMap<String, String>,
    ) -> Result<Vec<McpTool>, String> {
        let session = self
            .get_or_spawn(http, server_id, transport, command, args, env, url, headers)
            .await?;
        let result = session
            .request("tools/list", json!({}), LIST_TOOLS_TIMEOUT)
            .await?;
        let mut tools = Vec::new();
        if let Some(raw) = result.get("tools").and_then(|t| t.as_array()) {
            for t in raw {
                if let Ok(mut tool) = serde_json::from_value::<McpTool>(t.clone()) {
                    tool.server_id = server_id.to_string();
                    tool.server_name = server_name.to_string();
                    tools.push(tool);
                }
            }
        }
        Ok(tools)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn call_tool(
        &self,
        http: Option<reqwest::Client>,
        server_id: &str,
        transport: McpTransport,
        command: &str,
        args: &[String],
        env: &BTreeMap<String, String>,
        url: &str,
        headers: &BTreeMap<String, String>,
        tool_name: &str,
        arguments: &Value,
    ) -> Result<String, String> {
        let session = self
            .get_or_spawn(http, server_id, transport, command, args, env, url, headers)
            .await?;
        let result = session
            .request(
                "tools/call",
                json!({ "name": tool_name, "arguments": arguments }),
                CALL_TOOL_TIMEOUT,
            )
            .await?;
        Ok(format_tool_result(&result))
    }

    /// Kills every live session's child process. Called on app exit -
    /// without this, MCP server processes (often `npx`/`node`, sometimes
    /// spawning their own children) would outlive the window that started
    /// them.
    pub async fn shutdown_all(&self) {
        let sessions = self.sessions.lock().await;
        for (id, session) in sessions.iter() {
            tracing::debug!(server_id = %id, "shutting down MCP session");
            session.shutdown().await;
        }
    }
}

/// One-off connectivity check for a server config the user is currently
/// editing (Settings' "Test connection"): spawns a session, initializes,
/// lists tools, and tears it down immediately. Deliberately not registered
/// in an `McpManager` - the command/args typed into that form are unvalidated
/// and shouldn't become a persistent process keyed by a throwaway id.
pub async fn test_connection(
    http: Option<reqwest::Client>,
    transport: McpTransport,
    command: &str,
    args: &[String],
    env: &BTreeMap<String, String>,
    url: &str,
    headers: &BTreeMap<String, String>,
) -> Result<Vec<McpTool>, String> {
    let session =
        McpSession::spawn(http, "test", transport, command, args, env, url, headers).await?;
    let result = match session.initialize().await {
        Ok(()) => {
            session
                .request("tools/list", json!({}), LIST_TOOLS_TIMEOUT)
                .await
        }
        Err(e) => Err(e),
    };
    session.shutdown().await;

    let result = result?;
    let mut tools = Vec::new();
    if let Some(raw) = result.get("tools").and_then(|t| t.as_array()) {
        for t in raw {
            if let Ok(mut tool) = serde_json::from_value::<McpTool>(t.clone()) {
                tool.server_id = "test".to_string();
                tool.server_name = "test".to_string();
                tools.push(tool);
            }
        }
    }
    Ok(tools)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_tool_result_joins_text_content_blocks() {
        let result = json!({
            "content": [
                { "type": "text", "text": "first" },
                { "type": "text", "text": "second" }
            ]
        });
        assert_eq!(format_tool_result(&result), "first\nsecond");
    }

    #[test]
    fn format_tool_result_stringifies_non_text_blocks() {
        let result = json!({ "content": [{ "type": "image", "data": "abc" }] });
        assert_eq!(
            format_tool_result(&result),
            json!({ "type": "image", "data": "abc" }).to_string()
        );
    }

    #[test]
    fn format_tool_result_handles_null_result() {
        assert_eq!(
            format_tool_result(&Value::Null),
            "Tool executed successfully with empty result."
        );
    }

    #[test]
    fn format_tool_result_falls_back_to_raw_json_without_content() {
        let result = json!({ "ok": true });
        assert_eq!(format_tool_result(&result), result.to_string());
    }
}
