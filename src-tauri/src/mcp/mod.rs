use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::BTreeMap;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;

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

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolCallResult {
    #[serde(default)]
    pub content: Vec<serde_json::Value>,
    #[serde(default, rename = "isError")]
    pub is_error: bool,
}

fn create_command(
    command: &str,
    args: &[String],
    env: &BTreeMap<String, String>,
) -> Command {
    let mut cmd = Command::new(command);
    cmd.args(args);
    for (k, v) in env {
        cmd.env(k, v);
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW (0x08000000) prevents console popup on Windows
        cmd.creation_flags(0x08000000);
    }

    cmd
}

/// Handshakes with the MCP server via stdio and queries its list of available tools.
pub async fn query_tools(
    server_id: &str,
    server_name: &str,
    command: &str,
    args: &[String],
    env: &BTreeMap<String, String>,
) -> Result<Vec<McpTool>, String> {
    let mut child = create_command(command, args, env)
        .spawn()
        .map_err(|e| format!("Failed to spawn MCP server '{}': {}", command, e))?;

    let stdin = child
        .stdin
        .as_mut()
        .ok_or_else(|| "Failed to open stdin for MCP server".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open stdout for MCP server".to_string())?;
    let mut reader = BufReader::new(stdout).lines();

    // 1. Send `initialize` request
    let init_req = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {
                "name": "chat-studio",
                "version": "0.1.0"
            }
        }
    });
    let mut init_payload = serde_json::to_string(&init_req).unwrap();
    init_payload.push('\n');
    stdin
        .write_all(init_payload.as_bytes())
        .await
        .map_err(|e| format!("Failed to write initialize to MCP server: {}", e))?;
    stdin.flush().await.map_err(|e| e.to_string())?;

    // Read initialize response with timeout
    let init_line = timeout(Duration::from_secs(10), reader.next_line())
        .await
        .map_err(|_| "Timeout waiting for initialize response from MCP server".to_string())?
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "MCP server closed connection during initialize".to_string())?;

    let _init_resp: serde_json::Value = serde_json::from_str(&init_line)
        .map_err(|e| format!("Invalid JSON from MCP server: {}", e))?;

    // 2. Send `notifications/initialized`
    let initialized_notification = json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized"
    });
    let mut notif_payload = serde_json::to_string(&initialized_notification).unwrap();
    notif_payload.push('\n');
    stdin
        .write_all(notif_payload.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())?;

    // 3. Send `tools/list` request
    let tools_req = json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list",
        "params": {}
    });
    let mut tools_payload = serde_json::to_string(&tools_req).unwrap();
    tools_payload.push('\n');
    stdin
        .write_all(tools_payload.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())?;

    // Read tools/list response
    let tools_line = timeout(Duration::from_secs(10), reader.next_line())
        .await
        .map_err(|_| "Timeout waiting for tools/list response from MCP server".to_string())?
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "MCP server closed connection during tools/list".to_string())?;

    let tools_resp: serde_json::Value = serde_json::from_str(&tools_line)
        .map_err(|e| format!("Invalid tools/list JSON response: {}", e))?;

    let mut tools = Vec::new();
    if let Some(raw_tools) = tools_resp
        .get("result")
        .and_then(|r| r.get("tools"))
        .and_then(|t| t.as_array())
    {
        for t in raw_tools {
            if let Ok(mut tool) = serde_json::from_value::<McpTool>(t.clone()) {
                tool.server_id = server_id.to_string();
                tool.server_name = server_name.to_string();
                tools.push(tool);
            }
        }
    }

    // Clean up child process
    let _ = child.kill().await;

    Ok(tools)
}

/// Executes a tool call against an MCP server process.
pub async fn execute_tool(
    command: &str,
    args: &[String],
    env: &BTreeMap<String, String>,
    tool_name: &str,
    arguments: &serde_json::Value,
) -> Result<String, String> {
    let mut child = create_command(command, args, env)
        .spawn()
        .map_err(|e| format!("Failed to spawn MCP server '{}': {}", command, e))?;

    let stdin = child
        .stdin
        .as_mut()
        .ok_or_else(|| "Failed to open stdin for MCP server".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open stdout for MCP server".to_string())?;
    let mut reader = BufReader::new(stdout).lines();

    // 1. Initialize
    let init_req = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {
                "name": "chat-studio",
                "version": "0.1.0"
            }
        }
    });
    let mut init_payload = serde_json::to_string(&init_req).unwrap();
    init_payload.push('\n');
    stdin.write_all(init_payload.as_bytes()).await.map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())?;

    let _init_line = timeout(Duration::from_secs(10), reader.next_line())
        .await
        .map_err(|_| "Timeout initializing MCP server".to_string())?
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "MCP server closed during initialize".to_string())?;

    // 2. Initialized notification
    let notif = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
    let mut notif_payload = serde_json::to_string(&notif).unwrap();
    notif_payload.push('\n');
    stdin.write_all(notif_payload.as_bytes()).await.map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())?;

    // 3. Call tool
    let call_req = json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments
        }
    });
    let mut call_payload = serde_json::to_string(&call_req).unwrap();
    call_payload.push('\n');
    stdin.write_all(call_payload.as_bytes()).await.map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())?;

    // Read result
    let call_line = timeout(Duration::from_secs(60), reader.next_line())
        .await
        .map_err(|_| format!("Timeout executing MCP tool '{}'", tool_name))?
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "MCP server closed before returning result".to_string())?;

    let call_resp: serde_json::Value = serde_json::from_str(&call_line)
        .map_err(|e| format!("Invalid JSON response for tool '{}': {}", tool_name, e))?;

    let _ = child.kill().await;

    if let Some(err) = call_resp.get("error") {
        return Err(err.to_string());
    }

    if let Some(result) = call_resp.get("result") {
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
            return Ok(out);
        }
        return Ok(result.to_string());
    }

    Ok("Tool executed successfully with empty result.".into())
}
