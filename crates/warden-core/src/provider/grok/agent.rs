//! Grok backend: drives turns over a pooled ACP connection (see [`super::acp`]).
//! One `grok agent stdio` connection is kept per warden session; each turn sends
//! `session/prompt` and translates the streamed `session/update` notifications
//! into warden's normalized [`AgentEvent`]s. The blocking ACP protocol runs on a
//! `spawn_blocking` thread so it never stalls the async runtime.

use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::Value;

use crate::agent::settle::persist_event as persist;
use crate::error::{AppError, Result};
use crate::event::text::clip;
use crate::event::{emit_delta, TokenUsageKeys};
use crate::session::Session;
use crate::store::Store;
use crate::{AgentEvent, Backend, EffortLevel, PermissionMode, TokenUsage};

use super::acp::{self, Connection};

/// The `grok` binary — warden's resolved copy (system PATH in practice).
fn resolve_grok() -> std::path::PathBuf {
    crate::cli::resolve(crate::cli::Tool::Grok)
}

/// Strip the `grok/` routing prefix so the CLI receives the bare model id it
/// prints in `grok models` (e.g. `grok/grok-composer-2.5-fast` →
/// `grok-composer-2.5-fast`).
fn raw_model(model: &str) -> &str {
    model.strip_prefix("grok/").unwrap_or(model)
}

/// Grok's `--reasoning-effort` accepts `low`/`medium`/`high`; warden's higher
/// tiers clamp to `high` (Ultracode is Claude-only anyway).
pub(super) fn grok_effort(effort: EffortLevel) -> &'static str {
    match effort {
        EffortLevel::Low => "low",
        EffortLevel::Medium => "medium",
        EffortLevel::High | EffortLevel::Xhigh | EffortLevel::Max | EffortLevel::Ultracode => {
            "high"
        }
    }
}

/// Assemble the `grok agent stdio` argument vector. Bypass mode adds
/// `--always-approve` so the agent never round-trips a permission ask; other
/// modes are handled inline by the ACP permission responder.
fn build_agent_args(model: &str, mode: PermissionMode, effort: EffortLevel) -> Vec<String> {
    let mut args = vec![
        "--no-auto-update".to_string(),
        "agent".to_string(),
        "--no-leader".to_string(),
    ];
    if matches!(mode, PermissionMode::BypassPermissions) {
        args.push("--always-approve".to_string());
    }
    let model = raw_model(model);
    if !model.is_empty() {
        args.push("--model".to_string());
        args.push(model.to_string());
    }
    args.push("--reasoning-effort".to_string());
    args.push(grok_effort(effort).to_string());
    args.push("stdio".to_string());
    args
}

/// Whether to resume the persisted ACP session. Gated on the id alone (not
/// `turns > 0`): a cancelled first turn leaves `turns == 0` yet grok already
/// minted the session, so resuming by id is the only correct recovery.
fn should_resume(agent_session_id: &str) -> bool {
    !agent_session_id.is_empty()
}

/// Prepend the session's assembled context as a system block (ACP `session/prompt`
/// carries no separate system field).
fn build_message(instructions: &str, prompt: &str) -> String {
    if instructions.trim().is_empty() {
        prompt.to_string()
    } else {
        format!(
            "<system_instructions>\n{}\n</system_instructions>\n\n{prompt}",
            instructions.trim()
        )
    }
}

// ----- ACP notification translation -------------------------------------------

/// The ACP session id from a notification (`params.sessionId`) or the terminal
/// prompt response (`result._meta.sessionId`).
pub(super) fn extract_acp_session_id(value: &Value) -> Option<String> {
    for path in [
        ["params", "sessionId"].as_slice(),
        ["result", "_meta", "sessionId"].as_slice(),
    ] {
        let mut current = value;
        let found = path.iter().all(|key| {
            current = match current.get(*key) {
                Some(next) => next,
                None => return false,
            };
            true
        });
        if found {
            if let Some(id) = current.as_str() {
                if !id.is_empty() {
                    return Some(id.to_string());
                }
            }
        }
    }
    None
}

/// Token usage from a prompt response's `_meta`, normalized to [`TokenUsage`].
fn usage_from_result(value: &Value) -> Option<TokenUsage> {
    let meta = value.get("result").and_then(|r| r.get("_meta"))?;
    TokenUsage::from_keys(
        meta,
        &TokenUsageKeys {
            input: &["inputTokens", "input_tokens"],
            output: &["outputTokens", "output_tokens"],
            cache_read: &["cachedReadTokens", "cache_read_input_tokens"],
            cache_creation: &[],
        },
    )
}

/// Map an ACP tool `kind` to warden's normalized tool vocabulary, or `None` when
/// there is no equivalent (the caller falls back to the tool's title).
fn tool_name_for_kind(kind: &str) -> Option<&'static str> {
    match kind {
        "read" => Some("Read"),
        "edit" => Some("Edit"),
        "execute" => Some("Bash"),
        "search" => Some("Grep"),
        "fetch" => Some("WebFetch"),
        _ => None,
    }
}

fn text_of_content(content: &Value) -> Option<String> {
    if content.get("type").and_then(Value::as_str) != Some("text") {
        return None;
    }
    content
        .get("text")
        .and_then(Value::as_str)
        .filter(|t| !t.is_empty())
        .map(ToOwned::to_owned)
}

/// The readable output text for a completed tool call, from `rawOutput`.
fn tool_output(update: &Value) -> Option<String> {
    let raw = update.get("rawOutput")?;
    for path in [
        ["output_for_prompt"].as_slice(),
        ["outputForPrompt"].as_slice(),
        ["content"].as_slice(),
        ["text"].as_slice(),
    ] {
        if let Some(text) = path
            .iter()
            .try_fold(raw, |acc, key| acc.get(*key))
            .and_then(Value::as_str)
            .filter(|t| !t.is_empty())
        {
            return Some(text.to_string());
        }
    }
    // `output` may be a UTF-8 byte array or a nested value.
    if let Some(output) = raw.get("output") {
        return value_to_text(output);
    }
    value_to_text(raw)
}

fn value_to_text(value: &Value) -> Option<String> {
    let text = match value {
        Value::String(s) => s.clone(),
        Value::Array(items) => {
            let bytes: Option<Vec<u8>> = items
                .iter()
                .map(|i| i.as_u64().and_then(|n| u8::try_from(n).ok()))
                .collect();
            match bytes {
                Some(bytes) => String::from_utf8_lossy(&bytes).to_string(),
                None => value.to_string(),
            }
        }
        Value::Null => return None,
        other => other.to_string(),
    };
    (!text.is_empty()).then_some(text)
}

/// A parsed ACP tool call from a `tool_call`/`tool_call_update` notification.
fn parse_tool_call(update: &Value) -> Option<(String, String, Value)> {
    let id = update
        .get("toolCallId")
        .or_else(|| update.get("tool_call_id"))
        .and_then(Value::as_str)?
        .to_string();
    // A bare `tool_call_update` (output only) has none of these — skip it here.
    if update.get("title").is_none()
        && update.get("kind").is_none()
        && update.get("rawInput").is_none()
    {
        return None;
    }
    let name = update
        .get("kind")
        .and_then(Value::as_str)
        .and_then(tool_name_for_kind)
        .map(ToOwned::to_owned)
        .or_else(|| {
            update
                .get("title")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| "Tool".to_string());
    let input = update.get("rawInput").cloned().unwrap_or(Value::Null);
    Some((id, name, input))
}

/// What a translated notification produces.
enum Emit {
    Delta(String),
    Event(AgentEvent),
}

/// Running assistant/thinking text across a turn (ACP chunks are incremental).
#[derive(Default)]
struct GrokStream {
    text: String,
    text_flushed: usize,
    thinking: String,
    thinking_flushed: usize,
    seen_tools: std::collections::HashSet<String>,
}

impl GrokStream {
    fn flush_thinking(&mut self, sink: &mut impl FnMut(Emit)) {
        if self.thinking.len() > self.thinking_flushed {
            let segment = self.thinking[self.thinking_flushed..].to_string();
            self.thinking_flushed = self.thinking.len();
            if !segment.trim().is_empty() {
                sink(Emit::Event(AgentEvent::Thinking { text: segment }));
            }
        }
    }

    fn flush_text(&mut self, sink: &mut impl FnMut(Emit)) {
        if self.text.len() > self.text_flushed {
            let segment = self.text[self.text_flushed..].to_string();
            self.text_flushed = self.text.len();
            if !segment.trim().is_empty() {
                sink(Emit::Event(AgentEvent::AssistantText {
                    text: segment,
                    parent_tool_use_id: None,
                }));
            }
        }
    }

    fn flush_all(&mut self, sink: &mut impl FnMut(Emit)) {
        self.flush_thinking(sink);
        self.flush_text(sink);
    }
}

/// Translate one ACP `session/update` notification, updating `state` and
/// emitting ordered deltas/events.
fn process_update(state: &mut GrokStream, value: &Value, sink: &mut impl FnMut(Emit)) {
    let Some(update) = value
        .get("params")
        .and_then(|p| p.get("update"))
        .filter(|_| value.get("method").and_then(Value::as_str) == Some("session/update"))
    else {
        return;
    };

    match update.get("sessionUpdate").and_then(Value::as_str) {
        Some("agent_message_chunk") => {
            if let Some(text) = update.get("content").and_then(text_of_content) {
                state.flush_thinking(sink);
                state.text.push_str(&text);
                sink(Emit::Delta(text));
            }
        }
        Some("agent_thought_chunk") => {
            if let Some(text) = update.get("content").and_then(text_of_content) {
                state.thinking.push_str(&text);
            }
        }
        Some("tool_call") => {
            if let Some((id, name, input)) = parse_tool_call(update) {
                state.flush_all(sink);
                if state.seen_tools.insert(id.clone()) {
                    sink(Emit::Event(AgentEvent::ToolUse {
                        id,
                        name,
                        input,
                        parent_tool_use_id: None,
                    }));
                }
            }
        }
        Some("tool_call_update") => {
            if let Some((id, name, input)) = parse_tool_call(update) {
                if state.seen_tools.insert(id.clone()) {
                    state.flush_all(sink);
                    sink(Emit::Event(AgentEvent::ToolUse {
                        id,
                        name,
                        input,
                        parent_tool_use_id: None,
                    }));
                }
            }
            if let Some(id) = update
                .get("toolCallId")
                .or_else(|| update.get("tool_call_id"))
                .and_then(Value::as_str)
            {
                if let Some(output) = tool_output(update) {
                    sink(Emit::Event(AgentEvent::ToolResult {
                        tool_use_id: id.to_string(),
                        content: clip(output),
                        is_error: false,
                    }));
                }
            }
        }
        _ => {}
    }
}

// ----- turn execution ---------------------------------------------------------

/// Run one Grok turn end to end (blocking; call from `spawn_blocking`).
fn run_turn_blocking(
    store: &Store,
    session: &Session,
    prompt: &str,
    instructions: &str,
) -> Result<()> {
    let cli_path = resolve_grok();
    if crate::cli::system_binary(crate::cli::Tool::Grok).is_none() && !cli_path.exists() {
        return Err(AppError::Agent("Grok CLI not installed".to_string()));
    }

    let args = build_agent_args(&session.model, session.permission_mode, session.effort);
    // Resume on a persisted ACP session id alone: a first turn that was cancelled
    // never increments `turns`, but grok already created the session — gating on
    // `turns > 0` would discard it (matches the Claude provider's forced resume).
    let resume = should_resume(&session.agent_session_id).then(|| session.agent_session_id.clone());
    let message = build_message(instructions, prompt);

    let working_dir = std::path::Path::new(&session.working_dir);
    let read_only = matches!(session.permission_mode, PermissionMode::Plan);

    // Acquire a live, correctly-configured connection. A cancel-then-immediate
    // resend can be handed back a dead or wrong-mode pooled connection (it was
    // busy when `get_or_spawn` peeked, so it couldn't revalidate). Revalidate
    // after locking and respawn on mismatch rather than failing the turn; after
    // a couple of tries accept what we hold — `drive_turn` settles a genuine
    // death cleanly.
    let mut connection;
    let mut conn;
    let mut attempt = 0;
    loop {
        connection = acp::get_or_spawn(
            &session.id,
            &cli_path,
            args.clone(),
            working_dir,
            resume.as_deref(),
            session.permission_mode,
        )?;
        conn = connection.lock().unwrap_or_else(|p| p.into_inner());
        attempt += 1;
        if attempt >= 3 || (conn.is_alive() && acp::reusable_config(&conn, &args, read_only)) {
            break;
        }
        drop(conn);
        acp::drop_connection(&session.id);
    }
    conn.in_use = true;
    let (cancelled, kill_generation) =
        acp::register_kill(&session.id, conn.child(), conn.terminals(), conn.shutdown());

    // Persist the (possibly newly created) ACP session id so a later turn can
    // resume it even after the pooled connection dies.
    if !conn.acp_session_id.is_empty() && conn.acp_session_id != session.agent_session_id {
        let _ = store.set_agent_session_id(&session.id, &conn.acp_session_id);
    }

    let result = drive_turn(&mut conn, store, session, &message, &cancelled);
    conn.in_use = false;
    conn.last_used = std::time::Instant::now();
    let stderr = conn.stderr_tail();
    drop(conn);
    acp::unregister_kill(&session.id, kill_generation);

    match result {
        TurnEnd::Completed => Ok(()),
        TurnEnd::Cancelled => {
            acp::drop_connection(&session.id);
            Ok(())
        }
        TurnEnd::Died => {
            acp::drop_connection(&session.id);
            let detail = super::strip_ansi(&stderr);
            let message = if detail.trim().is_empty() {
                "grok exited mid-turn".to_string()
            } else {
                format!("grok exited mid-turn: {}", detail.trim())
            };
            Err(AppError::Agent(message))
        }
    }
}

enum TurnEnd {
    Completed,
    Cancelled,
    Died,
}

/// Classify a mid-turn error/EOF: a deliberate cancel (the kill handle set the
/// flag) settles cleanly; anything else is a real death. Every error exit path
/// in `drive_turn` must route through this so a cancel that kills grok while a
/// terminal command runs isn't misreported as "grok exited mid-turn".
fn died_or_cancelled(cancelled: &AtomicBool) -> TurnEnd {
    if cancelled.load(Ordering::SeqCst) {
        TurnEnd::Cancelled
    } else {
        TurnEnd::Died
    }
}

/// Send the prompt and drain the stream into persisted events. Persists a
/// terminal [`AgentEvent::Result`] on normal completion.
fn drive_turn(
    conn: &mut Connection,
    store: &Store,
    session: &Session,
    message: &str,
    cancelled: &AtomicBool,
) -> TurnEnd {
    let prompt_id = match conn.send_prompt(message) {
        Ok(id) => id,
        Err(_) => return died_or_cancelled(cancelled),
    };

    let mut state = GrokStream::default();
    let usage;
    let session_id = session.id.clone();
    let mode = session.permission_mode;

    loop {
        let value = match conn.read_message() {
            Ok(Some(value)) => value,
            Ok(None) | Err(_) => return died_or_cancelled(cancelled),
        };

        if Connection::is_client_request(&value) {
            if conn.handle_client_request(&value, mode).is_err() {
                return died_or_cancelled(cancelled);
            }
            continue;
        }

        if let Some(id) = extract_acp_session_id(&value) {
            if id != conn.acp_session_id {
                conn.acp_session_id = id.clone();
                let _ = store.set_agent_session_id(&session_id, &id);
            }
        }

        let mut emits = Vec::new();
        process_update(&mut state, &value, &mut |e| emits.push(e));
        for emit in emits {
            match emit {
                Emit::Delta(text) => emit_delta(&session_id, &text),
                Emit::Event(event) => persist(store, &session_id, event),
            }
        }

        if value.get("id").and_then(Value::as_i64) == Some(prompt_id) {
            if let Some(error) = value.get("error") {
                persist(
                    store,
                    &session_id,
                    AgentEvent::Error {
                        message: format!("grok prompt failed: {error}"),
                    },
                );
                // A prompt error is terminal for the turn but not a dead
                // connection; settle via a failed Result.
                persist(
                    store,
                    &session_id,
                    AgentEvent::Result {
                        is_error: true,
                        cost_usd: None,
                        duration_ms: None,
                        num_turns: None,
                        usage: None,
                    },
                );
                return TurnEnd::Completed;
            }
            usage = usage_from_result(&value);
            break;
        }
    }

    // Flush any trailing thinking/assistant text, then settle the turn.
    let mut trailing = Vec::new();
    state.flush_all(&mut |e| trailing.push(e));
    for emit in trailing {
        if let Emit::Event(event) = emit {
            persist(store, &session_id, event);
        }
    }
    persist(
        store,
        &session_id,
        AgentEvent::Result {
            is_error: false,
            cost_usd: None,
            duration_ms: None,
            num_turns: None,
            usage,
        },
    );
    TurnEnd::Completed
}

/// Run one Grok turn (async wrapper over the blocking ACP drive).
pub async fn run_turn(
    store: &Store,
    session: &Session,
    prompt: &str,
    instructions: &str,
) -> Result<()> {
    let store = store.clone();
    let session = session.clone();
    let prompt = prompt.to_string();
    let instructions = instructions.to_string();
    tokio::task::spawn_blocking(move || run_turn_blocking(&store, &session, &prompt, &instructions))
        .await
        .map_err(|e| AppError::Agent(format!("grok turn task panicked: {e}")))?
}

/// A single cheap Grok call for background workflows (naming, PR drafting). Runs
/// over the ACP stdio path (read-only), NOT `grok -p`: grok installs via npm, so
/// on Windows the binary is a `.cmd` shim and Rust's post-CVE-2024-24576 batch
/// spawning rejects args with quotes/newlines — passing the prompt via argv fails
/// on every multiline prompt. Over ACP the prompt rides `session/prompt` on
/// stdio, never argv. Returns the reply text, or `None` on any failure so callers
/// fall back gracefully.
pub async fn run_oneshot(working_dir: &std::path::Path, prompt: &str) -> Option<String> {
    let cli_path = resolve_grok();
    if crate::cli::system_binary(crate::cli::Tool::Grok).is_none() && !cli_path.exists() {
        return None;
    }
    // Read-only (plan) posture mirrors the prior `--sandbox read-only`; the fixed
    // stdio argv carries no user content.
    let args = build_agent_args(
        crate::model_config::fast_workflow_model(Backend::Grok),
        PermissionMode::Plan,
        EffortLevel::Low,
    );
    let dir = working_dir.to_path_buf();
    let prompt = prompt.to_string();

    let text = tokio::task::spawn_blocking(move || {
        acp::run_oneshot_blocking(&cli_path, args, &dir, &prompt)
    })
    .await
    .ok()?;

    let text = match text {
        Ok(text) => text,
        Err(e) => {
            log::warn!("oneshot: grok ACP failed: {e}");
            return None;
        }
    };
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

/// Interrupt a session's in-flight Grok turn by killing its ACP process.
pub fn interrupt(session_id: &str) {
    acp::interrupt(session_id);
}

/// Kill every pooled Grok connection (app shutdown).
pub fn kill_all() {
    acp::kill_all();
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn collect(values: &[Value]) -> (GrokStream, Vec<Emit>) {
        let mut state = GrokStream::default();
        let mut emits = Vec::new();
        for value in values {
            process_update(&mut state, value, &mut |e| emits.push(e));
        }
        (state, emits)
    }

    #[test]
    fn build_agent_args_maps_bypass_model_and_effort() {
        let args = build_agent_args(
            "grok/grok-composer-2.5-fast",
            PermissionMode::BypassPermissions,
            EffortLevel::Max,
        );
        assert_eq!(args[0], "--no-auto-update");
        assert!(args.contains(&"agent".to_string()));
        assert!(args.contains(&"stdio".to_string()));
        assert!(args.contains(&"--always-approve".to_string()));
        let model = args.iter().position(|a| a == "--model").unwrap();
        assert_eq!(args[model + 1], "grok-composer-2.5-fast");
        let effort = args.iter().position(|a| a == "--reasoning-effort").unwrap();
        assert_eq!(args[effort + 1], "high"); // Max clamps to high
    }

    #[test]
    fn resume_gate_uses_session_id_alone() {
        // Has a persisted id -> resume, even after a cancelled first turn
        // (turns == 0). Empty id -> fresh session.
        assert!(should_resume("acp-session-123"));
        assert!(!should_resume(""));
    }

    #[test]
    fn plan_mode_omits_always_approve() {
        let args = build_agent_args("grok/grok-build", PermissionMode::Plan, EffortLevel::Low);
        assert!(!args.contains(&"--always-approve".to_string()));
    }

    #[test]
    fn translates_message_chunks_and_tool_calls_in_order() {
        let values = vec![
            json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Reading."}}}}),
            json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"tool_call","toolCallId":"t1","kind":"read","rawInput":{"path":"a.rs"}}}}),
            json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"tool_call_update","toolCallId":"t1","rawOutput":"file body"}}}),
        ];
        let (state, emits) = collect(&values);

        // The message text before the tool is flushed as AssistantText, in order.
        let ordered: Vec<String> = emits
            .iter()
            .filter_map(|e| match e {
                Emit::Event(AgentEvent::AssistantText { text, .. }) => Some(format!("text:{text}")),
                Emit::Event(AgentEvent::ToolUse { name, .. }) => Some(format!("tool:{name}")),
                Emit::Event(AgentEvent::ToolResult { content, .. }) => {
                    Some(format!("result:{content}"))
                }
                _ => None,
            })
            .collect();
        assert_eq!(ordered[0], "text:Reading.");
        assert_eq!(ordered[1], "tool:Read");
        assert_eq!(ordered[2], "result:file body");
        // The tool is emitted once despite the follow-up update.
        assert_eq!(
            emits
                .iter()
                .filter(|e| matches!(e, Emit::Event(AgentEvent::ToolUse { .. })))
                .count(),
            1
        );
        assert!(state.text.contains("Reading."));
    }

    #[test]
    fn tool_output_reads_byte_arrays_and_prompt_text() {
        let update = json!({
            "toolCallId": "t1",
            "rawOutput": { "output_for_prompt": "Exit 0\nhi", "output": [105, 103] }
        });
        assert_eq!(tool_output(&update).as_deref(), Some("Exit 0\nhi"));
        let bytes = json!({ "toolCallId": "t1", "rawOutput": { "output": [104, 105] } });
        assert_eq!(tool_output(&bytes).as_deref(), Some("hi"));
    }

    #[test]
    fn extracts_session_id_from_params_and_result() {
        assert_eq!(
            extract_acp_session_id(&json!({"params":{"sessionId":"s9"}})).as_deref(),
            Some("s9")
        );
        assert_eq!(
            extract_acp_session_id(&json!({"result":{"_meta":{"sessionId":"s8"}}})).as_deref(),
            Some("s8")
        );
    }
}
