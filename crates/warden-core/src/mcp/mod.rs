//! Warden's in-app MCP server, exposed to agents over stdio.
//!
//! Launched as a child of an agent CLI (`warden mcp`), it speaks the Model
//! Context Protocol over stdin/stdout and lets the agent act on the user's
//! connected integrations — create a Linear issue, leave a comment, move an
//! issue's status — without a second login. Every tool resolves credentials the
//! same way the app does: the Linear key from the OS keychain, GitHub via `gh`.
//!
//! This is deliberately standalone: the v1 tools touch only on-disk credentials
//! and the network, never the running app's state, so no socket back to the GUI
//! is needed (unlike heavier designs that drive the app itself).

mod tools;

use std::io::{BufRead, Write};

use serde_json::{json, Value};

use crate::store::Store;

const PROTOCOL_VERSION: &str = "2025-06-18";

/// Settings key for the "let agents use Warden's MCP tools" toggle.
pub const SETTING_KEY: &str = "warden_mcp_enabled";

/// Whether agents should get Warden's MCP tools. Default on — only an explicit
/// "false" (set via the settings toggle) disables it.
pub fn is_enabled(store: &Store) -> bool {
    match store.get_setting(SETTING_KEY) {
        Ok(Some(v)) => v != "false",
        _ => true,
    }
}

/// Run the stdio MCP server to completion. Reads one JSON-RPC message per line,
/// writes one response per line, and returns when stdin closes (the parent CLI
/// exited). Blocking I/O on a dedicated tokio runtime for the async tool calls.
pub fn run_stdio() {
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("warden mcp: failed to start runtime: {e}");
            return;
        }
    };

    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();

    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Some(response) = runtime.block_on(handle_line(&line)) else {
            continue; // notification — no reply
        };
        if writeln!(out, "{response}").is_err() {
            break;
        }
        let _ = out.flush();
    }
}

/// Parse and dispatch one JSON-RPC line, returning the serialized response, or
/// `None` for notifications (no `id`) which the protocol says get no reply.
async fn handle_line(line: &str) -> Option<String> {
    let msg: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => {
            return Some(error_response(
                Value::Null,
                -32700,
                &format!("parse error: {e}"),
            ))
        }
    };

    let id = msg.get("id").cloned();
    let method = msg
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();

    // Notifications (no id) are fire-and-forget: acknowledge nothing.
    let id = id?;

    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "serverInfo": { "name": "warden", "version": env!("CARGO_PKG_VERSION") },
            "capabilities": { "tools": {} },
        })),
        "tools/list" => Ok(json!({ "tools": tools::registry() })),
        "tools/call" => call_tool(msg.get("params")).await,
        "ping" => Ok(json!({})),
        other => Err(format!("method not found: {other}")),
    };

    Some(match result {
        Ok(value) => success_response(id, value),
        Err(message) => error_response(id, -32603, &message),
    })
}

/// Invoke a tool. Tool-level failures come back as an MCP result with
/// `isError: true` (the agent sees the message), not a JSON-RPC error.
async fn call_tool(params: Option<&Value>) -> Result<Value, String> {
    let params = params.ok_or("tools/call requires params")?;
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or("tools/call requires a tool name")?;
    let arguments = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));

    match tools::call(name, arguments).await {
        Ok(text) => Ok(tool_text(&text, false)),
        Err(message) => Ok(tool_text(&message, true)),
    }
}

/// Wrap plain text as an MCP tool result content block.
fn tool_text(text: &str, is_error: bool) -> Value {
    json!({
        "content": [{ "type": "text", "text": text }],
        "isError": is_error,
    })
}

fn success_response(id: Value, result: Value) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string()
}

fn error_response(id: Value, code: i32, message: &str) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }).to_string()
}
