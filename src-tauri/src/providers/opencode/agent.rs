//! OpenCode backend: drives turns against the shared `opencode serve` HTTP
//! server (see [`super::server`]). Each warden session maps to one OpenCode
//! session, created lazily on the first turn and resumed by id thereafter.
//!
//! A turn is one `POST /session/{id}/message` request, which returns the
//! completed assistant message (all parts) when the turn ends. While the POST
//! is in flight, a per-turn task tails the server's SSE event stream
//! (`GET /event`) for live UX: assistant text streams in as transient deltas,
//! and finished tool calls are persisted as they complete. The final transcript
//! (assistant text, thinking, any tools the stream missed, token usage) is
//! written from the POST response, deduplicating tools by call id — so a
//! dropped SSE connection degrades to end-of-turn rendering, never data loss.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, LazyLock, Mutex};

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::domain::{AgentEvent, EffortLevel, PermissionMode, Session, TokenUsage};
use crate::error::{AppError, Result};
use crate::events::emit_delta;
use crate::providers::{clip, persist_event as persist};
use crate::store::Store;

use super::server;

/// Where an in-flight turn runs: enough to address a server-side abort.
#[derive(Clone)]
struct TurnHandle {
    base_url: String,
    oc_session_id: String,
    directory: String,
}

/// In-flight turns by warden session id. Used to abort on cancel.
static TURNS: LazyLock<Mutex<HashMap<String, TurnHandle>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn turns() -> std::sync::MutexGuard<'static, HashMap<String, TurnHandle>> {
    TURNS.lock().unwrap_or_else(|p| p.into_inner())
}

/// Abort a session's in-flight OpenCode turn (`POST /session/{id}/abort`).
/// Returns whether a turn was found. The in-flight message POST then returns
/// with whatever the turn produced, which settles the session.
pub fn interrupt(session_id: &str) -> bool {
    let Some(turn) = turns().get(session_id).cloned() else {
        return false;
    };
    tauri::async_runtime::spawn(async move {
        let _ = server::client()
            .post(format!(
                "{}/session/{}/abort",
                turn.base_url, turn.oc_session_id
            ))
            .query(&[("directory", turn.directory.as_str())])
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await;
    });
    true
}

/// Kill the shared OpenCode server (app shutdown). Idempotent.
pub fn kill_all() {
    server::kill_all();
}

// ----- request building -------------------------------------------------------

/// Split a warden model id into OpenCode's (providerID, modelID) pair.
/// `opencode/<model>` selects the OpenCode Zen gateway; `opencode/<provider>/
/// <model>` (or a bare `<provider>/<model>`) passes through to that provider.
fn parse_model(model: &str) -> (String, String) {
    let raw = model.strip_prefix("opencode/").unwrap_or(model);
    match raw.split_once('/') {
        Some((provider, model_id)) => (provider.to_string(), model_id.to_string()),
        None => ("opencode".to_string(), raw.to_string()),
    }
}

/// Map warden's effort to OpenCode's `variant`. OpenCode tops out at `max`
/// (no `xhigh` tier), so both upper tiers clamp to it.
fn variant_for_effort(effort: EffortLevel) -> &'static str {
    match effort {
        EffortLevel::Low => "low",
        EffortLevel::Medium => "medium",
        EffortLevel::High => "high",
        EffortLevel::Xhigh | EffortLevel::Max => "max",
    }
}

/// OpenCode's execution agent: `plan` is read-only research; everything else
/// runs the full `build` agent (sessions are worktree-isolated, mirroring the
/// bypass-by-default posture of the other backends).
fn agent_for_mode(mode: PermissionMode) -> &'static str {
    match mode {
        PermissionMode::Plan => "plan",
        _ => "build",
    }
}

/// Create a fresh OpenCode session for `dir`, returning its id.
async fn create_session(base_url: &str, dir: &str, title: &str) -> Result<String> {
    let response = server::client()
        .post(format!("{base_url}/session"))
        .query(&[("directory", dir)])
        .json(&json!({ "title": title }))
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| AppError::Agent(format!("opencode session create failed: {e}")))?;
    let body: Value = response
        .error_for_status()
        .map_err(|e| AppError::Agent(format!("opencode session create failed: {e}")))?
        .json()
        .await
        .map_err(|e| AppError::Agent(format!("opencode session create unparseable: {e}")))?;
    body.get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| AppError::Agent("opencode session create response missing id".to_string()))
}

/// The message payload for one turn.
fn turn_payload(session: &Session, prompt: &str, base_instructions: &str) -> Value {
    let (provider_id, model_id) = parse_model(&session.model);
    let mut payload = json!({
        "agent": agent_for_mode(session.permission_mode),
        "model": { "providerID": provider_id, "modelID": model_id },
        "variant": variant_for_effort(session.effort),
        "parts": [{ "type": "text", "text": prompt }],
    });
    if !base_instructions.is_empty() {
        payload["system"] = json!(base_instructions);
    }
    payload
}

// ----- turn execution ---------------------------------------------------------

/// Run one OpenCode turn end to end: ensure the server is up, create/reuse the
/// session, tail the event stream for live deltas and tool calls, and persist
/// the final transcript from the message response. Settles the session to
/// `Idle` on completion (run-to-completion, like the Codex adapter).
pub async fn run_turn(
    app: &AppHandle,
    store: &Store,
    session: &Session,
    prompt: &str,
    base_instructions: &str,
) -> Result<()> {
    let base_url = server::ensure().await?;
    let dir = session.working_dir.clone();

    // Reuse the session's OpenCode conversation after the first turn; otherwise
    // (first turn, or a stale id rejected below) start a fresh one.
    let mut resumed = session.turns > 0 && !session.agent_session_id.is_empty();
    let mut oc_id = if resumed {
        session.agent_session_id.clone()
    } else {
        let id = create_session(&base_url, &dir, &format!("Warden {}", session.title)).await?;
        store.set_agent_session_id(&session.id, &id)?;
        id
    };

    let payload = turn_payload(session, prompt, base_instructions);
    let outcome = loop {
        turns().insert(
            session.id.clone(),
            TurnHandle {
                base_url: base_url.clone(),
                oc_session_id: oc_id.clone(),
                directory: dir.clone(),
            },
        );
        // Tool calls persisted live from the stream, so the response pass can
        // skip them. The stream task is torn down before that pass runs.
        let persisted_tools = Arc::new(Mutex::new(HashSet::new()));
        let sse = tauri::async_runtime::spawn(tail_events(
            app.clone(),
            store.clone(),
            session.id.clone(),
            base_url.clone(),
            oc_id.clone(),
            dir.clone(),
            persisted_tools.clone(),
        ));

        let result = server::client()
            .post(format!("{base_url}/session/{oc_id}/message"))
            .query(&[("directory", dir.as_str())])
            .json(&payload)
            .send()
            .await;

        sse.abort();
        let _ = sse.await;

        let response = result.map_err(|e| {
            turns().remove(&session.id);
            AppError::Agent(format!("opencode message failed: {e}"))
        })?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            // A resumed id the server no longer knows (wiped storage, foreign
            // machine): start a fresh conversation and retry once.
            if resumed {
                log::warn!("opencode rejected session {oc_id} ({status}); starting a new session");
                resumed = false;
                oc_id = create_session(&base_url, &dir, &format!("Warden {}", session.title))
                    .await
                    .inspect_err(|_| {
                        turns().remove(&session.id);
                    })?;
                store.set_agent_session_id(&session.id, &oc_id)?;
                continue;
            }
            turns().remove(&session.id);
            let detail = body.chars().take(400).collect::<String>();
            return Err(AppError::Agent(format!(
                "opencode message failed ({status}): {detail}"
            )));
        }
        let body: Value = response.json().await.map_err(|e| {
            turns().remove(&session.id);
            AppError::Agent(format!("opencode message response unparseable: {e}"))
        })?;
        break (body, persisted_tools);
    };
    turns().remove(&session.id);

    let (body, persisted_tools) = outcome;
    // Upstream failures (provider auth, balance, context overflow) come back as
    // 200 OK with an embedded error object and empty parts.
    if let Some(message) = extract_error(&body) {
        return Err(AppError::Agent(message));
    }

    let persisted_tools = persisted_tools
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone();
    let (events, usage) = response_events(&body, prompt, &persisted_tools);
    for event in events {
        persist(app, store, &session.id, event);
    }
    persist(
        app,
        store,
        &session.id,
        AgentEvent::Result {
            is_error: false,
            cost_usd: None,
            duration_ms: None,
            num_turns: None,
            usage,
        },
    );
    Ok(())
}

// ----- final response translation ----------------------------------------------

/// Translate the completed message's parts into transcript events, skipping
/// tool calls the stream already persisted. Returns the events plus the turn's
/// token usage (from the last `step-finish` part).
fn response_events(
    body: &Value,
    prompt: &str,
    persisted_tools: &HashSet<String>,
) -> (Vec<AgentEvent>, Option<TokenUsage>) {
    let parts = body
        .get("parts")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut events = Vec::new();
    let mut usage = None;
    // OpenCode echoes the user prompt as the leading text part; skip that one.
    let mut leading = true;
    // Consecutive reasoning parts merge into one Thinking event.
    let mut thinking = String::new();

    for part in &parts {
        let part_type = part.get("type").and_then(Value::as_str).unwrap_or_default();
        if part_type != "reasoning" && !thinking.is_empty() {
            events.push(AgentEvent::Thinking {
                text: std::mem::take(&mut thinking),
            });
        }
        match part_type {
            "text" => {
                let text = part.get("text").and_then(Value::as_str).unwrap_or_default();
                if leading && text.trim() == prompt.trim() {
                    leading = false;
                    continue;
                }
                leading = false;
                if !text.is_empty() {
                    events.push(AgentEvent::AssistantText {
                        text: text.to_string(),
                        parent_tool_use_id: None,
                    });
                }
            }
            "reasoning" => {
                leading = false;
                let text = part.get("text").and_then(Value::as_str).unwrap_or_default();
                if !text.is_empty() {
                    if !thinking.is_empty() {
                        thinking.push_str("\n\n");
                    }
                    thinking.push_str(text);
                }
            }
            "tool" => {
                leading = false;
                if let Some((id, tool_use, tool_result)) = tool_events(part) {
                    if !persisted_tools.contains(&id) {
                        events.push(tool_use);
                        if let Some(result) = tool_result {
                            events.push(result);
                        }
                    }
                }
            }
            "step-finish" => {
                if let Some(u) = step_usage(part) {
                    usage = Some(u);
                }
            }
            _ => {}
        }
    }
    if !thinking.is_empty() {
        events.push(AgentEvent::Thinking { text: thinking });
    }
    (events, usage)
}

/// Token usage from a `step-finish` part's `tokens` object.
fn step_usage(part: &Value) -> Option<TokenUsage> {
    let tokens = part.get("tokens")?;
    let get = |v: Option<&Value>| v.and_then(Value::as_u64).unwrap_or(0);
    let cache = tokens.get("cache");
    let usage = TokenUsage {
        input_tokens: get(tokens.get("input")),
        output_tokens: get(tokens.get("output")),
        cache_read_input_tokens: get(cache.and_then(|c| c.get("read"))),
        cache_creation_input_tokens: get(cache.and_then(|c| c.get("write"))),
    };
    (usage != TokenUsage::default()).then_some(usage)
}

/// Map a `tool` part to a `ToolUse` (+ `ToolResult` once it finished). Returns
/// the call id for dedup against stream-persisted tools.
fn tool_events(part: &Value) -> Option<(String, AgentEvent, Option<AgentEvent>)> {
    let id = part
        .get("callID")
        .or_else(|| part.get("id"))
        .and_then(Value::as_str)?
        .to_string();
    let raw_name = part.get("tool").and_then(Value::as_str).unwrap_or("tool");
    let state = part.get("state").cloned().unwrap_or_default();
    let mut input = state.get("input").cloned().unwrap_or_else(|| json!({}));
    let name = normalize_tool(raw_name, &mut input);

    let status = state
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let result = match status {
        "completed" => {
            state
                .get("output")
                .and_then(Value::as_str)
                .map(|out| AgentEvent::ToolResult {
                    tool_use_id: id.clone(),
                    content: clip(out.to_string()),
                    is_error: false,
                })
        }
        "error" => Some(AgentEvent::ToolResult {
            tool_use_id: id.clone(),
            content: clip(
                state
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("tool failed")
                    .to_string(),
            ),
            is_error: true,
        }),
        _ => None,
    };

    let tool_use = AgentEvent::ToolUse {
        id: id.clone(),
        name,
        input,
        parent_tool_use_id: None,
    };
    Some((id, tool_use, result))
}

/// Rename a single key in a JSON object (no-op if missing or not an object).
fn rename_key(value: &mut Value, from: &str, to: &str) {
    if let Some(obj) = value.as_object_mut() {
        if let Some(v) = obj.remove(from) {
            obj.entry(to.to_string()).or_insert(v);
        }
    }
}

/// Normalize OpenCode's lowercase tool ids and camelCase params to the Claude
/// conventions the transcript renderer expects (`Read`/`file_path`, …).
/// Unknown tools pass through unchanged.
fn normalize_tool(name: &str, input: &mut Value) -> String {
    match name {
        "read" => {
            rename_key(input, "filePath", "file_path");
            "Read".to_string()
        }
        "edit" => {
            rename_key(input, "filePath", "file_path");
            rename_key(input, "oldString", "old_string");
            rename_key(input, "newString", "new_string");
            rename_key(input, "replaceAll", "replace_all");
            "Edit".to_string()
        }
        "write" => {
            rename_key(input, "filePath", "file_path");
            "Write".to_string()
        }
        "bash" => "Bash".to_string(),
        "glob" => "Glob".to_string(),
        "grep" => {
            // OpenCode calls the file filter `include`; Claude calls it `glob`.
            rename_key(input, "include", "glob");
            "Grep".to_string()
        }
        "task" => "Task".to_string(),
        "todowrite" => "TodoWrite".to_string(),
        "webfetch" => "WebFetch".to_string(),
        "websearch" => "WebSearch".to_string(),
        other => other.to_string(),
    }
}

/// A human-readable message from an embedded OpenCode error object (returned
/// as 200 OK with `info.error` set), unwrapping upstream provider errors when
/// present.
fn extract_error(body: &Value) -> Option<String> {
    let error = body
        .get("info")
        .and_then(|i| i.get("error"))
        .or_else(|| body.get("error"))
        .filter(|e| !e.is_null())?;
    let data = error.get("data").cloned().unwrap_or(Value::Null);
    // Upstream provider errors arrive double-encoded in `data.responseBody`.
    if let Some(response_body) = data.get("responseBody").and_then(Value::as_str) {
        if let Ok(inner) = serde_json::from_str::<Value>(response_body) {
            if let Some(message) = inner
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(Value::as_str)
            {
                return Some(message.to_string());
            }
        }
    }
    data.get("message")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            error
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .or_else(|| Some(error.to_string()))
}

// ----- live event stream --------------------------------------------------------

/// What we've seen of a streaming message part, keyed by part id.
enum PartTrack {
    /// Text we've already emitted up to `emitted` bytes. The first snapshot of
    /// a part sets the baseline without emitting — which also naturally
    /// swallows the user-prompt part (it arrives complete, never grows).
    Text { emitted: usize },
    /// Reasoning streams are not surfaced live; tracked so their deltas aren't
    /// mistaken for text.
    Reasoning,
}

/// Tail the server's SSE stream for one turn: emit transient text deltas and
/// persist tool calls as they complete. Aborted by the caller when the message
/// POST returns; errors here only degrade live UX (the POST response is the
/// source of truth), so the task gives up rather than reconnecting.
async fn tail_events(
    app: AppHandle,
    store: Store,
    session_id: String,
    base_url: String,
    oc_session_id: String,
    dir: String,
    persisted_tools: Arc<Mutex<HashSet<String>>>,
) {
    let response = match server::client()
        .get(format!("{base_url}/event"))
        .query(&[("directory", dir.as_str())])
        .header("Accept", "text/event-stream")
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            log::warn!("opencode event stream refused: {}", r.status());
            return;
        }
        Err(e) => {
            log::warn!("opencode event stream failed: {e}");
            return;
        }
    };

    let mut response = response;
    let mut buffer = String::new();
    let mut data = String::new();
    let mut parts: HashMap<String, PartTrack> = HashMap::new();

    loop {
        let chunk = match response.chunk().await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => return,
            Err(e) => {
                log::warn!("opencode event stream read error: {e}");
                return;
            }
        };
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(newline) = buffer.find('\n') {
            let line = buffer[..newline].trim_end_matches('\r').to_string();
            buffer.drain(..=newline);
            if let Some(payload) = line.strip_prefix("data:") {
                if !data.is_empty() {
                    data.push('\n');
                }
                data.push_str(payload.trim_start());
            } else if line.is_empty() && !data.is_empty() {
                handle_event(
                    &app,
                    &store,
                    &session_id,
                    &oc_session_id,
                    &data,
                    &mut parts,
                    &persisted_tools,
                );
                data.clear();
            }
        }
    }
}

/// Process one SSE event for this turn's OpenCode session.
fn handle_event(
    app: &AppHandle,
    store: &Store,
    session_id: &str,
    oc_session_id: &str,
    data: &str,
    parts: &mut HashMap<String, PartTrack>,
    persisted_tools: &Arc<Mutex<HashSet<String>>>,
) {
    let Ok(event) = serde_json::from_str::<Value>(data) else {
        return;
    };
    let payload = event.get("payload").unwrap_or(&event);
    let event_type = payload
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let props = payload.get("properties").cloned().unwrap_or_default();

    match event_type {
        "message.part" | "message.part.added" | "message.part.updated" => {
            let Some(part) = props.get("part") else {
                return;
            };
            if part.get("sessionID").and_then(Value::as_str) != Some(oc_session_id) {
                return;
            }
            handle_part_snapshot(app, store, session_id, part, parts, persisted_tools);
        }
        "message.part.delta" => {
            if props.get("sessionID").and_then(Value::as_str) != Some(oc_session_id) {
                return;
            }
            let part_id = props
                .get("partID")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let field = props
                .get("field")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let delta = props
                .get("delta")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if part_id.is_empty() || delta.is_empty() || field != "text" {
                return;
            }
            match parts.get_mut(part_id) {
                Some(PartTrack::Text { emitted }) => {
                    *emitted += delta.len();
                    emit_delta(app, session_id, delta);
                }
                Some(PartTrack::Reasoning) => {}
                None => {
                    parts.insert(
                        part_id.to_string(),
                        PartTrack::Text {
                            emitted: delta.len(),
                        },
                    );
                    emit_delta(app, session_id, delta);
                }
            }
        }
        _ => {}
    }
}

/// Process a full part snapshot: stream unseen text as deltas, and persist a
/// tool call once it reaches a terminal state.
fn handle_part_snapshot(
    app: &AppHandle,
    store: &Store,
    session_id: &str,
    part: &Value,
    parts: &mut HashMap<String, PartTrack>,
    persisted_tools: &Arc<Mutex<HashSet<String>>>,
) {
    let part_id = part.get("id").and_then(Value::as_str).unwrap_or_default();
    match part.get("type").and_then(Value::as_str).unwrap_or_default() {
        "text" => {
            let text = part.get("text").and_then(Value::as_str).unwrap_or_default();
            match parts.get_mut(part_id) {
                Some(PartTrack::Text { emitted }) => {
                    if text.len() > *emitted && text.is_char_boundary(*emitted) {
                        emit_delta(app, session_id, &text[*emitted..]);
                    }
                    *emitted = (*emitted).max(text.len());
                }
                Some(PartTrack::Reasoning) => {}
                None => {
                    // First sight is the baseline — emit nothing, so a part
                    // that arrives complete (the user prompt) stays silent.
                    parts.insert(
                        part_id.to_string(),
                        PartTrack::Text {
                            emitted: text.len(),
                        },
                    );
                }
            }
        }
        "reasoning" => {
            parts.insert(part_id.to_string(), PartTrack::Reasoning);
        }
        "tool" => {
            let status = part
                .get("state")
                .and_then(|s| s.get("status"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            if status != "completed" && status != "error" {
                return;
            }
            let Some((id, tool_use, tool_result)) = tool_events(part) else {
                return;
            };
            {
                let mut seen = persisted_tools.lock().unwrap_or_else(|p| p.into_inner());
                if !seen.insert(id) {
                    return;
                }
            }
            persist(app, store, session_id, tool_use);
            if let Some(result) = tool_result {
                persist(app, store, session_id, result);
            }
        }
        _ => {}
    }
}

// ----- one-shots ------------------------------------------------------------------

/// A single cheap model call for background workflows (naming, PR drafting):
/// a throwaway OpenCode session driven by the provider's fast-workflow model,
/// run on the read-only `plan` agent. Returns the reply text, or `None` on any
/// failure so callers can fall back gracefully.
pub async fn run_oneshot(working_dir: &std::path::Path, prompt: &str) -> Option<String> {
    let base_url = match server::ensure().await {
        Ok(url) => url,
        Err(e) => {
            log::warn!("oneshot: opencode server unavailable: {e}");
            return None;
        }
    };
    let dir = working_dir.to_string_lossy().into_owned();
    let oc_id = match create_session(&base_url, &dir, "Warden one-shot").await {
        Ok(id) => id,
        Err(e) => {
            log::warn!("oneshot: opencode session create failed: {e}");
            return None;
        }
    };

    let (provider_id, model_id) = parse_model(crate::model_config::fast_workflow_model(
        crate::domain::Backend::Opencode,
    ));
    let payload = json!({
        "agent": "plan",
        "model": { "providerID": provider_id, "modelID": model_id },
        "parts": [{ "type": "text", "text": prompt }],
    });
    let body: Value = match server::client()
        .post(format!("{base_url}/session/{oc_id}/message"))
        .query(&[("directory", dir.as_str())])
        .json(&payload)
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .and_then(|r| r.error_for_status())
    {
        Ok(response) => match response.json().await {
            Ok(body) => body,
            Err(e) => {
                log::warn!("oneshot: opencode response unparseable: {e}");
                return None;
            }
        },
        Err(e) => {
            log::warn!("oneshot: opencode message failed: {e}");
            return None;
        }
    };
    if let Some(message) = extract_error(&body) {
        log::warn!("oneshot: opencode reported an error: {message}");
        return None;
    }

    let (events, _) = response_events(&body, prompt, &HashSet::new());
    let text = events
        .iter()
        .filter_map(|e| match e {
            AgentEvent::AssistantText { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n");
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_model_ids() {
        assert_eq!(
            parse_model("opencode/kimi-k2.6"),
            ("opencode".to_string(), "kimi-k2.6".to_string())
        );
        assert_eq!(
            parse_model("opencode/anthropic/claude-sonnet-4-5"),
            ("anthropic".to_string(), "claude-sonnet-4-5".to_string())
        );
        assert_eq!(
            parse_model("ollama/qwen3"),
            ("ollama".to_string(), "qwen3".to_string())
        );
    }

    #[test]
    fn skips_prompt_echo_and_merges_thinking() {
        let body = serde_json::json!({
            "parts": [
                { "type": "text", "text": "do the thing" },
                { "type": "reasoning", "text": "hmm" },
                { "type": "reasoning", "text": "okay" },
                { "type": "text", "text": "done" },
                { "type": "step-finish", "tokens": { "input": 10, "output": 5, "cache": { "read": 2 } } }
            ]
        });
        let (events, usage) = response_events(&body, "do the thing", &HashSet::new());
        assert!(matches!(
            &events[0],
            AgentEvent::Thinking { text } if text == "hmm\n\nokay"
        ));
        assert!(matches!(
            &events[1],
            AgentEvent::AssistantText { text, .. } if text == "done"
        ));
        assert_eq!(usage.unwrap().input_tokens, 10);
    }

    #[test]
    fn normalizes_tool_names_and_params() {
        let mut input =
            serde_json::json!({ "filePath": "a.rs", "oldString": "x", "newString": "y" });
        assert_eq!(normalize_tool("edit", &mut input), "Edit");
        assert_eq!(input.get("file_path").and_then(Value::as_str), Some("a.rs"));
        assert!(input.get("filePath").is_none());
        assert_eq!(input.get("old_string").and_then(Value::as_str), Some("x"));
    }
}
