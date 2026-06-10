//! Codex backend: drives turns against `codex app-server`, a persistent
//! JSON-RPC 2.0 server speaking newline-delimited JSON over stdio.
//!
//! One app-server process is shared across every Codex session; each warden
//! session maps to one Codex *thread*. The JSON-RPC plumbing (request
//! correlation, notification routing) lives in [`crate::providers::jsonrpc`];
//! this module does protocol translation only — Codex events become warden's
//! normalized [`AgentEvent`] so Codex turns render in the existing transcript
//! unchanged.
//!
//! Unlike Claude session processes, the app-server is NOT left running across
//! app shutdown. Verified empirically (codex 0.136): the server aborts the
//! in-flight turn and exits the moment its client's pipes close, recording a
//! clean `turn_aborted` in its rollout file — so there is nothing to survive
//! *to*. Conversation state persists on disk (`~/.codex/sessions`) and the next
//! turn resumes the thread via `thread/resume`. True turn survival needs
//! `codex app-server daemon` + `proxy`, which is Unix-only today; revisit when
//! it ships on Windows.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};

use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::sync::Mutex as AsyncMutex;

use crate::domain::{AgentEvent, EffortLevel, PermissionMode, Session, SessionStatus, TokenUsage};
use crate::error::{AppError, Result};
use crate::events::{emit_delta, emit_event, emit_session};
use crate::providers::jsonrpc::Client;
use crate::store::Store;

/// Tool-result content larger than this is clipped to keep the event log and
/// the IPC payload bounded (mirrors the Claude adapter's cap).
const MAX_TOOL_RESULT_CHARS: usize = 16_000;
const TRUNCATION_NOTE: &str = "… (truncated)";

/// The shared app-server client. A dead server (crash, kill) is replaced on
/// the next turn rather than wedging Codex until app restart.
static SERVER: Mutex<Option<Arc<Client>>> = Mutex::new(None);
/// Serializes spawn + `initialize` so racing first turns can't double-spawn.
static INIT: AsyncMutex<()> = AsyncMutex::const_new(());
/// In-flight turns: session id → (threadId, turnId). The turnId is empty
/// until `turn/started`; used to send `turn/interrupt` on cancel.
static TURNS: LazyLock<Mutex<HashMap<String, (String, String)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// The `codex` binary to run — warden's managed copy or the system PATH one,
/// per the tool's source preference.
fn resolve_codex() -> std::path::PathBuf {
    crate::cli::resolve(crate::cli::Tool::Codex)
}

fn current() -> Option<Arc<Client>> {
    SERVER.lock().unwrap_or_else(|p| p.into_inner()).clone()
}

/// The live app-server client, spawning and initializing one if there is none
/// — or if the previous one died. The handshake (`initialize` request +
/// `initialized` notification) completes before this returns.
async fn server() -> Result<Arc<Client>> {
    if let Some(client) = current() {
        if client.is_alive() {
            return Ok(client);
        }
    }
    let _guard = INIT.lock().await;
    if let Some(client) = current() {
        if client.is_alive() {
            return Ok(client);
        }
    }

    let mut cmd = tokio::process::Command::new(resolve_codex());
    cmd.arg("app-server");
    let client = Client::spawn("codex app-server", cmd, route)?;
    initialize(&client).await?;
    *SERVER.lock().unwrap_or_else(|p| p.into_inner()) = Some(client.clone());
    Ok(client)
}

/// Notification routing key: most carry `threadId`; `thread/started` nests it
/// under `thread.id`.
fn route(_method: &str, params: &Value) -> Option<String> {
    params
        .get("threadId")
        .or_else(|| params.get("thread").and_then(|t| t.get("id")))
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// Run the `initialize` handshake. Must be called once, right after spawn.
async fn initialize(client: &Client) -> Result<()> {
    let params = json!({
        "clientInfo": { "name": "warden", "title": "Warden", "version": "0.1.0" },
        "capabilities": { "experimentalApi": true }
    });
    client.request("initialize", params).await?;
    client.notify("initialized", json!({})).await
}

fn turns() -> std::sync::MutexGuard<'static, HashMap<String, (String, String)>> {
    TURNS.lock().unwrap_or_else(|p| p.into_inner())
}

fn register_turn(session_id: &str, thread_id: &str) {
    turns().insert(
        session_id.to_string(),
        (thread_id.to_string(), String::new()),
    );
}

/// Record the turn id once `turn/started` arrives, so a cancel can address it.
fn set_turn_id(session_id: &str, turn_id: &str) {
    if let Some(entry) = turns().get_mut(session_id) {
        entry.1 = turn_id.to_string();
    }
}

fn unregister_turn(session_id: &str) {
    turns().remove(session_id);
}

/// Interrupt a session's in-flight Codex turn (`turn/interrupt`). Returns whether
/// a turn was found. The server ends the turn and emits a terminating
/// `turn/completed`, which settles the session to idle and breaks its drain loop.
pub fn interrupt(session_id: &str) -> bool {
    let entry = turns().get(session_id).cloned();
    let Some((thread_id, turn_id)) = entry else {
        return false;
    };
    if turn_id.is_empty() {
        return false;
    }
    let Some(client) = current() else {
        return false;
    };
    let params = json!({ "threadId": thread_id, "turnId": turn_id });
    // Fire-and-forget — we don't need the response, only for the server to stop.
    tauri::async_runtime::spawn(async move {
        let _ = client.request("turn/interrupt", params).await;
    });
    true
}

/// Kill the shared app-server (app shutdown). Idempotent. The server would
/// abort its turns and exit on our death anyway (see module docs) — killing
/// is just the tidy version.
pub fn kill_all() {
    if let Some(client) = current() {
        client.kill();
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

/// Token usage from a `turn/completed` turn object, normalized to [`TokenUsage`].
/// Codex names its cached input `cachedInputTokens`; returns `None` if absent so
/// the context gauge simply doesn't show rather than reading zero.
fn codex_usage(turn: Option<&Value>) -> Option<TokenUsage> {
    let usage = turn?.get("usage")?;
    let get = |keys: &[&str]| {
        keys.iter()
            .find_map(|k| usage.get(k).and_then(Value::as_u64))
            .unwrap_or(0)
    };
    let normalized = TokenUsage {
        input_tokens: get(&["inputTokens", "input_tokens"]),
        output_tokens: get(&["outputTokens", "output_tokens"]),
        cache_read_input_tokens: get(&["cachedInputTokens", "cached_input_tokens"]),
        cache_creation_input_tokens: 0,
    };
    (normalized != TokenUsage::default()).then_some(normalized)
}

/// Build `thread/start` params for an autonomous (3a) Codex thread. The session's
/// model selects the engine; the `-fast` suffix maps to the priority service tier.
fn thread_params(session: &Session, base_instructions: &str) -> Value {
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
    // The session's assembled context sources, prepended to Codex's instructions.
    if !base_instructions.is_empty() {
        params["baseInstructions"] = json!(base_instructions);
    }
    params
}

/// A structured `workspaceWrite`/`readOnly` sandbox policy. Full file reads are
/// allowed; writes are confined to `writable_roots`.
fn structured_policy(kind: &str, writable_roots: Vec<String>) -> Value {
    json!({
        "type": kind,
        "writableRoots": writable_roots,
        "readOnlyAccess": { "type": "fullAccess" },
        "networkAccess": true,
        "excludeTmpdirEnvVar": false,
        "excludeSlashTmp": false,
    })
}

/// The per-turn sandbox policy for a Codex turn, derived from the session's
/// *current* permission mode. Sent on `turn/start` (not just `thread/start`) so
/// it tracks live mode changes and enforces plan mode — a thread's sandbox is
/// otherwise fixed when the thread starts. Writable roots span the session's
/// working dir plus any extra roots.
fn sandbox_policy(session: &Session, add_dirs: &[String]) -> Value {
    match session.permission_mode {
        // Plan mode is read-only: the agent researches but can't edit.
        PermissionMode::Plan => structured_policy("readOnly", vec![]),
        // Bypass drops the sandbox entirely (e.g. tools needing the full machine).
        PermissionMode::BypassPermissions => json!({ "type": "dangerFullAccess" }),
        PermissionMode::AcceptEdits | PermissionMode::Default => {
            let mut roots = vec![session.working_dir.clone()];
            roots.extend(add_dirs.iter().filter(|d| !d.is_empty()).cloned());
            structured_policy("workspaceWrite", roots)
        }
    }
}

/// Start a new Codex thread (or resume the session's existing one), returning
/// the thread id. The id is persisted so later turns resume the conversation.
async fn start_or_resume(
    client: &Client,
    store: &Store,
    session: &Session,
    base_instructions: &str,
) -> Result<String> {
    if session.turns > 0 && !session.agent_session_id.is_empty() {
        let mut params = thread_params(session, base_instructions);
        params["threadId"] = json!(session.agent_session_id);
        match client.request("thread/resume", params).await {
            Ok(_) => return Ok(session.agent_session_id.clone()),
            Err(e) => log::warn!(
                "codex thread/resume failed for {}: {e}; starting a new thread",
                session.id
            ),
        }
    }

    let response = client
        .request("thread/start", thread_params(session, base_instructions))
        .await?;
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
    base_instructions: &str,
) -> Result<()> {
    let client = server().await?;
    let thread_id = start_or_resume(&client, store, session, base_instructions).await?;

    let mut rx = client.subscribe(&thread_id);
    // Track the turn so a cancel can `turn/interrupt` it (turn id filled in on
    // the `turn/started` notification).
    register_turn(&session.id, &thread_id);

    // Extra roots (non-primary projects) are writable in edit modes.
    let add_dirs: Vec<String> = store
        .list_session_root_projects(&session.id)
        .unwrap_or_default()
        .into_iter()
        .filter(|p| p.id != session.project_id)
        .map(|p| p.path)
        .collect();

    let turn_params = json!({
        "threadId": thread_id,
        "input": [{ "type": "text", "text": prompt }],
        "effort": codex_effort(session.effort),
        "sandboxPolicy": sandbox_policy(session, &add_dirs),
    });
    if let Err(e) = client.request("turn/start", turn_params).await {
        client.unsubscribe(&thread_id);
        unregister_turn(&session.id);
        return Err(e);
    }

    let mut finished = false;
    while let Some(note) = rx.recv().await {
        if handle_notification(app, store, &session.id, &note.method, &note.params) {
            finished = true;
            break;
        }
    }
    client.unsubscribe(&thread_id);
    unregister_turn(&session.id);

    // The channel closing before `turn/completed` means the server died
    // mid-turn. Surface it — otherwise the session sits `Running` forever.
    if !finished {
        let detail = client.stderr_tail();
        let message = if detail.is_empty() {
            "codex app-server exited mid-turn".to_string()
        } else {
            format!("codex app-server exited mid-turn: {detail}")
        };
        return Err(AppError::Agent(message));
    }
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
        "turn/started" => {
            if let Some(turn_id) = params
                .get("turn")
                .and_then(|t| t.get("id"))
                .and_then(Value::as_str)
            {
                set_turn_id(session_id, turn_id);
            }
            false
        }
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
                    usage: codex_usage(turn),
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
