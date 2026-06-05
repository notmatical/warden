//! Codex backend: drives turns against `codex app-server`, a persistent
//! JSON-RPC 2.0 server speaking newline-delimited JSON over stdio.
//!
//! One app-server process is shared across every Codex session; each warden
//! session maps to one Codex *thread*. Requests are matched to responses by
//! their numeric `id`; notifications (no `id`) are routed to the owning session
//! by their `threadId`. Codex events are translated into warden's normalized
//! [`AgentEvent`] so Codex turns render in the existing transcript unchanged.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::{mpsc, oneshot, Mutex as AsyncMutex};

use crate::domain::{AgentEvent, EffortLevel, Session, SessionStatus};
use crate::error::{AppError, Result};
use crate::events::{emit_delta, emit_event, emit_session};
use crate::store::Store;

/// Tool-result content larger than this is clipped to keep the event log and
/// the IPC payload bounded (mirrors the Claude adapter's cap).
const MAX_TOOL_RESULT_CHARS: usize = 16_000;
const TRUNCATION_NOTE: &str = "… (truncated)";

/// A notification the reader routed to a thread's owner.
struct Notification {
    method: String,
    params: Value,
}

/// The shared app-server process and its JSON-RPC plumbing.
struct CodexServer {
    /// Writer half of the process stdin; serialized requests are written here.
    stdin: AsyncMutex<ChildStdin>,
    /// The child handle, kept so the process can be killed on app exit.
    child: Mutex<Child>,
    /// Monotonic JSON-RPC request id.
    next_id: AtomicU64,
    /// In-flight requests awaiting a response, keyed by id.
    pending: Mutex<HashMap<u64, oneshot::Sender<std::result::Result<Value, String>>>>,
    /// Active threads: threadId → notification sink for the owning turn.
    threads: Mutex<HashMap<String, mpsc::UnboundedSender<Notification>>>,
}

static SERVER: OnceLock<CodexServer> = OnceLock::new();

/// The `codex` binary to run — warden's managed copy or the system PATH one,
/// per the tool's source preference.
fn resolve_codex() -> std::path::PathBuf {
    crate::cli::resolve(crate::cli::Tool::Codex)
}

/// Spawn + initialize the app-server if it isn't already running. Idempotent;
/// safe to call before every turn. The handshake (`initialize` request +
/// `initialized` notification) completes before this returns.
pub async fn ensure_running() -> Result<()> {
    if SERVER.get().is_some() {
        return Ok(());
    }

    let bin = resolve_codex();
    let mut child = tokio::process::Command::new(bin)
        .arg("app-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::Agent("failed to capture codex stdin".to_string()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Agent("failed to capture codex stdout".to_string()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Agent("failed to capture codex stderr".to_string()))?;

    let server = CodexServer {
        stdin: AsyncMutex::new(stdin),
        child: Mutex::new(child),
        next_id: AtomicU64::new(1),
        pending: Mutex::new(HashMap::new()),
        threads: Mutex::new(HashMap::new()),
    };

    // Another task may have raced us here; if so, drop ours (its child is killed
    // on drop) and use the winner.
    if SERVER.set(server).is_err() {
        return Ok(());
    }

    tauri::async_runtime::spawn(drain_stderr(stderr));
    tauri::async_runtime::spawn(reader_loop(stdout));

    initialize().await
}

fn server() -> Result<&'static CodexServer> {
    SERVER
        .get()
        .ok_or_else(|| AppError::Agent("codex app-server is not running".to_string()))
}

/// Run the `initialize` handshake. Must be called once, right after spawn.
async fn initialize() -> Result<()> {
    let params = json!({
        "clientInfo": { "name": "warden", "title": "Warden", "version": "0.1.0" },
        "capabilities": { "experimentalApi": true }
    });
    send_request("initialize", params).await?;

    // The `initialized` notification carries no id and expects no response.
    write_message(&json!({
        "jsonrpc": "2.0",
        "method": "initialized",
        "params": {}
    }))
    .await
}

/// Serialize and write one JSON-RPC message to the server's stdin.
async fn write_message(msg: &Value) -> Result<()> {
    let line = serde_json::to_string(msg)?;
    let server = server()?;
    let mut stdin = server.stdin.lock().await;
    stdin.write_all(line.as_bytes()).await?;
    stdin.write_all(b"\n").await?;
    stdin.flush().await?;
    Ok(())
}

/// Send a JSON-RPC request and await its response. Errors carry the server's
/// error message when the response is an error object.
pub async fn send_request(method: &str, params: Value) -> Result<Value> {
    let server = server()?;
    let id = server.next_id.fetch_add(1, Ordering::SeqCst);

    let (tx, rx) = oneshot::channel();
    server
        .pending
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .insert(id, tx);

    let request = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    });
    if let Err(e) = write_message(&request).await {
        server
            .pending
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(&id);
        return Err(e);
    }

    // A control RPC (initialize / thread / turn start) always responds promptly;
    // the turn's actual work streams as notifications. A missing response means
    // something is wrong — time out rather than hang the turn forever.
    match tokio::time::timeout(std::time::Duration::from_secs(60), rx).await {
        Ok(Ok(Ok(value))) => Ok(value),
        Ok(Ok(Err(message))) => Err(AppError::Agent(message)),
        Ok(Err(_)) => Err(AppError::Agent(format!(
            "codex app-server dropped the response to {method}"
        ))),
        Err(_) => {
            server
                .pending
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .remove(&id);
            Err(AppError::Agent(format!(
                "codex app-server timed out responding to {method}"
            )))
        }
    }
}

async fn drain_stderr(stderr: tokio::process::ChildStderr) {
    let mut buf = String::new();
    let mut reader = stderr;
    let _ = reader.read_to_string(&mut buf).await;
    let trimmed = buf.trim();
    if !trimmed.is_empty() {
        log::debug!("codex app-server stderr: {trimmed}");
    }
}

/// Read the server's stdout line by line: responses resolve pending requests,
/// notifications route to the owning thread. On EOF the server is gone — fail
/// every pending request and disconnect every thread channel.
async fn reader_loop(stdout: tokio::process::ChildStdout) {
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<Value>(line) else {
            log::warn!("codex app-server: unparseable line: {line}");
            continue;
        };

        let has_id = msg.get("id").is_some();
        let method = msg.get("method").and_then(Value::as_str);

        match (method, has_id) {
            // Response to one of our requests.
            (None, true) => dispatch_response(&msg),
            // Notification (no id) — route by threadId.
            (Some(method), false) => dispatch_notification(method, &msg),
            // Server-initiated request (e.g. an approval prompt). Out of scope
            // for 3a; the `never` approval policy means these shouldn't arrive,
            // but log them rather than dropping silently.
            (Some(method), true) => {
                log::debug!("codex app-server: ignoring server request {method}");
            }
            (None, false) => {}
        }
    }

    if let Some(server) = SERVER.get() {
        for (_, tx) in server
            .pending
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .drain()
        {
            let _ = tx.send(Err("codex app-server exited".to_string()));
        }
        server
            .threads
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clear();
    }
    log::warn!("codex app-server stdout closed");
}

fn dispatch_response(msg: &Value) {
    let Some(server) = SERVER.get() else { return };
    let Some(id) = msg.get("id").and_then(Value::as_u64) else {
        return;
    };
    let Some(tx) = server
        .pending
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .remove(&id)
    else {
        return;
    };
    let result = if let Some(err) = msg.get("error") {
        let message = err
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown error")
            .to_string();
        Err(message)
    } else {
        Ok(msg.get("result").cloned().unwrap_or(Value::Null))
    };
    let _ = tx.send(result);
}

fn dispatch_notification(method: &str, msg: &Value) {
    let Some(server) = SERVER.get() else { return };
    let params = msg.get("params").cloned().unwrap_or(Value::Null);

    // Most notifications carry `threadId`; `thread/started` nests it under
    // `thread.id`.
    let thread_id = params
        .get("threadId")
        .or_else(|| params.get("thread").and_then(|t| t.get("id")))
        .and_then(Value::as_str);

    let Some(thread_id) = thread_id else {
        return;
    };
    if let Some(tx) = server
        .threads
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .get(thread_id)
    {
        let _ = tx.send(Notification {
            method: method.to_string(),
            params,
        });
    }
}

fn register_thread(thread_id: &str, tx: mpsc::UnboundedSender<Notification>) {
    if let Some(server) = SERVER.get() {
        server
            .threads
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(thread_id.to_string(), tx);
    }
}

fn unregister_thread(thread_id: &str) {
    if let Some(server) = SERVER.get() {
        server
            .threads
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(thread_id);
    }
}

/// Kill the shared app-server (app shutdown). Idempotent.
pub fn kill_all() {
    if let Some(server) = SERVER.get() {
        if let Ok(mut child) = server.child.lock() {
            let _ = child.start_kill();
        }
    }
}

// ----- turn execution -------------------------------------------------------

/// Split a fast model id into its base model and a fast-tier flag, e.g.
/// `gpt-5.5-fast` → (`gpt-5.5`, true). Codex exposes the priority tier on the
/// gpt-5.5 / gpt-5.4 family; ids that merely happen to end in `-fast` are left
/// as-is so they don't silently request a tier the model doesn't offer.
fn split_fast_model(model: &str) -> (&str, bool) {
    match model {
        "gpt-5.5-fast" => ("gpt-5.5", true),
        "gpt-5.4-fast" => ("gpt-5.4", true),
        "gpt-5.4-mini-fast" => ("gpt-5.4-mini", true),
        other => (other.strip_suffix("-fast").unwrap_or(other), false),
    }
}

/// Codex's reasoning effort omits Claude's `max` tier; clamp it to the highest
/// Codex accepts so a session carried over from Claude still starts.
fn codex_effort(effort: EffortLevel) -> &'static str {
    match effort {
        EffortLevel::Max => "xhigh",
        other => other.as_cli(),
    }
}

/// Build `thread/start` params for an autonomous (3a) Codex thread. The session's
/// model selects the engine; the `-fast` suffix maps to the priority service tier.
fn thread_params(session: &Session) -> Value {
    let (model, is_fast) = split_fast_model(&session.model);
    let mut params = json!({
        "cwd": session.working_dir,
        "approvalPolicy": "never",
        "sandbox": "workspace-write",
        "model": model,
    });
    if is_fast {
        params["serviceTier"] = json!("fast");
    }
    params
}

/// Start a new Codex thread (or resume the session's existing one), returning
/// the thread id. The id is persisted so later turns resume the conversation.
async fn start_or_resume(store: &Store, session: &Session) -> Result<String> {
    if session.turns > 0 && !session.agent_session_id.is_empty() {
        let mut params = thread_params(session);
        params["threadId"] = json!(session.agent_session_id);
        match send_request("thread/resume", params).await {
            Ok(_) => return Ok(session.agent_session_id.clone()),
            Err(e) => log::warn!(
                "codex thread/resume failed for {}: {e}; starting a new thread",
                session.id
            ),
        }
    }

    let response = send_request("thread/start", thread_params(session)).await?;
    let thread_id = response
        .get("thread")
        .and_then(|t| t.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Agent("thread/start response missing thread.id".to_string()))?
        .to_string();
    store.set_agent_session_id(&session.id, &thread_id)?;
    Ok(thread_id)
}

/// Run one Codex turn end to end: ensure the server is up, start/resume the
/// thread, send the prompt, then translate the streamed notifications into
/// persisted [`AgentEvent`]s. Settles the session to `Idle`/`Error` on
/// completion (this path runs the turn to completion rather than returning
/// early like the Claude persistent process).
pub async fn run_turn(
    app: &AppHandle,
    store: &Store,
    session: &Session,
    prompt: &str,
) -> Result<()> {
    ensure_running().await?;
    let thread_id = start_or_resume(store, session).await?;

    let (tx, mut rx) = mpsc::unbounded_channel::<Notification>();
    register_thread(&thread_id, tx);

    let turn_params = json!({
        "threadId": thread_id,
        "input": [{ "type": "text", "text": prompt }],
        "effort": codex_effort(session.effort),
    });
    if let Err(e) = send_request("turn/start", turn_params).await {
        unregister_thread(&thread_id);
        return Err(e);
    }

    while let Some(note) = rx.recv().await {
        if handle_notification(app, store, &session.id, &note.method, &note.params) {
            break;
        }
    }
    unregister_thread(&thread_id);
    Ok(())
}

/// Translate one notification into events, persisting and emitting them.
/// Returns `true` when the turn is finished (the caller should stop draining).
fn handle_notification(
    app: &AppHandle,
    store: &Store,
    session_id: &str,
    method: &str,
    params: &Value,
) -> bool {
    match method {
        "item/agentMessage/delta" => {
            if let Some(delta) = params.get("delta").and_then(Value::as_str) {
                emit_delta(app, session_id, delta);
            }
            false
        }
        "item/completed" => {
            for event in item_events(params.get("item")) {
                persist(app, store, session_id, event);
            }
            false
        }
        "turn/completed" => {
            let turn = params.get("turn");
            let is_error =
                turn.and_then(|t| t.get("status")).and_then(Value::as_str) == Some("failed");
            persist(
                app,
                store,
                session_id,
                AgentEvent::Result {
                    is_error,
                    cost_usd: None,
                    duration_ms: turn
                        .and_then(|t| t.get("durationMs"))
                        .and_then(Value::as_u64),
                    num_turns: None,
                },
            );
            true
        }
        "error" => {
            let message = params
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("codex reported an error")
                .to_string();
            persist(app, store, session_id, AgentEvent::Error { message });
            // A non-retrying error ends the turn; a retry keeps it alive.
            params.get("willRetry").and_then(Value::as_bool) == Some(false)
        }
        _ => false,
    }
}

fn persist(app: &AppHandle, store: &Store, session_id: &str, event: AgentEvent) {
    let is_result = matches!(event, AgentEvent::Result { .. });
    if let Ok(record) = store.append_event(session_id, &event) {
        emit_event(app, &record);
    }
    // The turn's terminal event settles the session back to idle.
    if is_result {
        let _ = store.record_turn(session_id, 0.0);
        let _ = store.set_session_status(session_id, SessionStatus::Idle);
        if let Ok(session) = store.get_session(session_id) {
            emit_session(app, &session);
        }
    }
}

/// Map a completed Codex thread item to warden events. Item `type` is camelCase
/// in current Codex; snake_case is accepted for forward/backward compatibility.
fn item_events(item: Option<&Value>) -> Vec<AgentEvent> {
    let Some(item) = item else {
        return Vec::new();
    };
    let item_type = item.get("type").and_then(Value::as_str).unwrap_or_default();
    let id = item
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    match item_type {
        "agentMessage" | "agent_message" => item
            .get("text")
            .and_then(Value::as_str)
            .filter(|t| !t.is_empty())
            .map(|text| {
                vec![AgentEvent::AssistantText {
                    text: text.to_string(),
                    parent_tool_use_id: None,
                }]
            })
            .unwrap_or_default(),

        "reasoning" => reasoning_text(item)
            .map(|text| vec![AgentEvent::Thinking { text }])
            .unwrap_or_default(),

        "commandExecution" | "command_execution" => command_events(item, id),
        "fileChange" | "file_change" => file_change_events(item, id),
        "mcpToolCall" | "mcp_tool_call" => mcp_events(item, id),
        "webSearch" | "web_search" => web_search_events(item, id),
        _ => Vec::new(),
    }
}

/// Reasoning items carry `summary` and `content` arrays of strings.
fn reasoning_text(item: &Value) -> Option<String> {
    let join = |key: &str| {
        item.get(key)
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .filter(|s| !s.is_empty())
    };
    join("summary").or_else(|| join("content"))
}

fn command_events(item: &Value, id: String) -> Vec<AgentEvent> {
    let command = item
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mut events = vec![AgentEvent::ToolUse {
        id: id.clone(),
        name: "Bash".to_string(),
        input: json!({ "command": command }),
        parent_tool_use_id: None,
    }];

    // A completed command carries its output and exit status.
    let output = item
        .get("aggregatedOutput")
        .or_else(|| item.get("aggregated_output"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let exit_code = item
        .get("exitCode")
        .or_else(|| item.get("exit_code"))
        .and_then(Value::as_i64);
    let is_error = matches!(exit_code, Some(code) if code != 0)
        || item.get("status").and_then(Value::as_str) == Some("failed");

    events.push(AgentEvent::ToolResult {
        tool_use_id: id,
        content: clip(output.to_string()),
        is_error,
    });
    events
}

fn file_change_events(item: &Value, id: String) -> Vec<AgentEvent> {
    let changes = item.get("changes").and_then(Value::as_array);
    let files: Vec<Value> = changes
        .map(|arr| {
            arr.iter()
                .map(|c| {
                    json!({
                        "path": c.get("path").and_then(Value::as_str).unwrap_or_default(),
                        "kind": c.get("kind").cloned().unwrap_or(Value::Null),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let summary = changes
        .map(|arr| {
            arr.iter()
                .filter_map(|c| c.get("diff").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    let is_error = item.get("status").and_then(Value::as_str) == Some("failed");

    vec![
        AgentEvent::ToolUse {
            id: id.clone(),
            name: "Edit".to_string(),
            input: json!({ "changes": files }),
            parent_tool_use_id: None,
        },
        AgentEvent::ToolResult {
            tool_use_id: id,
            content: clip(summary),
            is_error,
        },
    ]
}

fn mcp_events(item: &Value, id: String) -> Vec<AgentEvent> {
    let server = item
        .get("server")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let tool = item.get("tool").and_then(Value::as_str).unwrap_or_default();
    let name = if server.is_empty() {
        tool.to_string()
    } else {
        format!("{server}/{tool}")
    };
    let is_error = item.get("error").map(|e| !e.is_null()).unwrap_or(false)
        || item.get("status").and_then(Value::as_str) == Some("failed");
    let content = item
        .get("result")
        .map(stringify)
        .filter(|s| !s.is_empty())
        .or_else(|| item.get("error").map(stringify))
        .unwrap_or_default();

    vec![
        AgentEvent::ToolUse {
            id: id.clone(),
            name,
            input: item.get("arguments").cloned().unwrap_or(Value::Null),
            parent_tool_use_id: None,
        },
        AgentEvent::ToolResult {
            tool_use_id: id,
            content: clip(content),
            is_error,
        },
    ]
}

fn web_search_events(item: &Value, id: String) -> Vec<AgentEvent> {
    let query = item
        .get("query")
        .and_then(Value::as_str)
        .unwrap_or_default();
    vec![AgentEvent::ToolUse {
        id,
        name: "WebSearch".to_string(),
        input: json!({ "query": query }),
        parent_tool_use_id: None,
    }]
}

fn stringify(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn clip(mut s: String) -> String {
    if s.chars().count() > MAX_TOOL_RESULT_CHARS {
        let cutoff = s
            .char_indices()
            .nth(MAX_TOOL_RESULT_CHARS)
            .map(|(i, _)| i)
            .unwrap_or(s.len());
        s.truncate(cutoff);
        s.push_str(TRUNCATION_NOTE);
    }
    s
}
