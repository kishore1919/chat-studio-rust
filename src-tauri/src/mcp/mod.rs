use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::process::Stdio;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};
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
    stdin: Mutex<ChildStdin>,
    pending: Arc<Mutex<HashMap<i64, oneshot::Sender<Value>>>>,
    next_id: AtomicI64,
    child: Mutex<Child>,
}

impl McpSession {
    async fn spawn(
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
            stdin: Mutex::new(stdin),
            pending,
            next_id: AtomicI64::new(1),
            child: Mutex::new(child),
        })
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
        let mut line = serde_json::to_string(&req).map_err(|e| e.to_string())?;
        line.push('\n');
        {
            let mut stdin = self.stdin.lock().await;
            if let Err(e) = stdin.write_all(line.as_bytes()).await {
                self.pending.lock().await.remove(&id);
                return Err(format!("failed to write to MCP server: {e}"));
            }
            if let Err(e) = stdin.flush().await {
                self.pending.lock().await.remove(&id);
                return Err(format!("failed to flush MCP server stdin: {e}"));
            }
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
        let mut line = serde_json::to_string(&notif).map_err(|e| e.to_string())?;
        line.push('\n');
        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        stdin.flush().await.map_err(|e| e.to_string())
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
        matches!(self.child.lock().await.try_wait(), Ok(None))
    }

    async fn shutdown(&self) {
        let _ = self.child.lock().await.kill().await;
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
    async fn get_or_spawn(
        &self,
        server_id: &str,
        command: &str,
        args: &[String],
        env: &BTreeMap<String, String>,
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

        match McpSession::spawn(server_id, command, args, env).await {
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

    pub async fn list_tools(
        &self,
        server_id: &str,
        server_name: &str,
        command: &str,
        args: &[String],
        env: &BTreeMap<String, String>,
    ) -> Result<Vec<McpTool>, String> {
        let session = self.get_or_spawn(server_id, command, args, env).await?;
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

    pub async fn call_tool(
        &self,
        server_id: &str,
        command: &str,
        args: &[String],
        env: &BTreeMap<String, String>,
        tool_name: &str,
        arguments: &Value,
    ) -> Result<String, String> {
        let session = self.get_or_spawn(server_id, command, args, env).await?;
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
    command: &str,
    args: &[String],
    env: &BTreeMap<String, String>,
) -> Result<Vec<McpTool>, String> {
    let session = McpSession::spawn("test", command, args, env).await?;
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
