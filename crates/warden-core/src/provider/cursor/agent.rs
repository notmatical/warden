//! Cursor backend: drives turns against the `cursor-agent` CLI, one process per
//! turn. Cursor prints newline-delimited JSON (`--output-format stream-json`) as
//! it works; this module spawns the process, translates those lines into
//! warden's normalized [`AgentEvent`]s, and persists them so a Cursor turn
//! renders in the existing transcript unchanged.
//!
//! Unlike the server-backed providers there is no shared process: each turn is a
//! fresh `cursor-agent --print …` invocation. The first turn's chat id is
//! persisted as the session's `agent_session_id` so later turns resume it with
//! `--resume`. Interrupting a turn kills its process; there is nothing to survive
//! across app shutdown.

use std::sync::{Arc, LazyLock, Mutex};

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::agent::registry::TurnRegistry;
use crate::agent::settle::persist_event as persist;
use crate::error::{AppError, Result};
use crate::event::text::clip;
use crate::event::{emit_delta, TokenUsageKeys};
use crate::session::Session;
use crate::store::Store;
use crate::{AgentEvent, PermissionMode, TokenUsage};

/// A per-turn Cursor process, addressable for cancel. The child is held behind a
/// mutex so [`interrupt`] can kill it from another task; `cancelled` records that
/// the kill was deliberate so the drain loop settles cleanly instead of erroring.
#[derive(Clone)]
struct CursorTurn {
    child: Arc<Mutex<tokio::process::Child>>,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
}

/// In-flight turns by warden session id. Used to kill the process on cancel.
static TURNS: LazyLock<TurnRegistry<CursorTurn>> = LazyLock::new(TurnRegistry::new);

/// The `cursor-agent` binary — warden's resolved copy (system PATH in practice).
fn resolve_cursor() -> std::path::PathBuf {
    crate::cli::resolve(crate::cli::Tool::Cursor)
}

/// Strip the `cursor/` routing prefix so the CLI receives the bare model id it
/// prints in `cursor-agent models` (e.g. `cursor/auto` → `auto`).
fn raw_model(model: &str) -> &str {
    model.strip_prefix("cursor/").unwrap_or(model)
}

/// The permission flags for a turn. Warden sessions are worktree-isolated, so
/// non-plan modes auto-approve edits (`--force`); plan mode runs read-only.
/// Cursor's finer bypass tiers aren't distinguished in v1.
fn mode_args(mode: PermissionMode) -> Vec<String> {
    match mode {
        PermissionMode::Plan => vec!["--mode".to_string(), "plan".to_string()],
        _ => vec!["--force".to_string()],
    }
}

/// Assemble the `cursor-agent` argument vector for one turn. The prompt is the
/// trailing positional argument, guarded by a `--` sentinel so a message that
/// starts with `-` is treated as text rather than parsed as flags. `resume`
/// carries the chat id for a continuing session (empty on the first turn);
/// `model` is the full `cursor/…` id.
fn build_args(model: &str, mode: PermissionMode, resume: &str, prompt: &str) -> Vec<String> {
    let mut args = vec![
        "--print".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--trust".to_string(),
    ];
    if !resume.is_empty() {
        args.push("--resume".to_string());
        args.push(resume.to_string());
    }
    let model = raw_model(model);
    if !model.is_empty() {
        args.push("--model".to_string());
        args.push(model.to_string());
    }
    args.extend(mode_args(mode));
    args.push("--".to_string());
    args.push(prompt.to_string());
    args
}

/// Guard against the two ways the trailing prompt argument can silently break on
/// Windows, where `cursor-agent` is often an npm-installed `.cmd` shim: Rust
/// refuses to pass a batch file arguments containing quotes or newlines
/// (CVE-2024-24576 mitigation), and every Windows command line is capped at
/// 32,767 characters. Rather than let either mangle the turn, reject up front
/// with an actionable error. A no-op on non-Windows targets.
#[cfg(windows)]
fn check_spawn_limits(bin: &std::path::Path, args: &[String]) -> Result<()> {
    // Rough command-line length: the binary plus each arg and a separating space.
    let approx_len = bin.as_os_str().len() + args.iter().map(|a| a.len() + 1).sum::<usize>();
    if approx_len > 32_000 {
        return Err(AppError::Agent(
            "This message is too large for the Cursor CLI on Windows, which caps a \
             command line near 32,000 characters. Shorten the message or split the task."
                .to_string(),
        ));
    }

    let is_batch = bin
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"));
    if is_batch
        && args
            .iter()
            .any(|a| a.contains('"') || a.contains('\n') || a.contains('\r'))
    {
        return Err(AppError::Agent(
            "The Cursor CLI on Windows is installed as a .cmd shim, which can't receive a \
             message containing quotes or line breaks. Reinstall cursor-agent from \
             cursor.com/install (a native binary) to send this message."
                .to_string(),
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn check_spawn_limits(_bin: &std::path::Path, _args: &[String]) -> Result<()> {
    Ok(())
}

/// Map Cursor's tool-call type key to warden's normalized tool vocabulary, or
/// `None` for kinds without an equivalent (they fall through to a generic name).
fn tool_name_for(key: &str) -> Option<&'static str> {
    match key {
        "editToolCall" => Some("Edit"),
        "shellToolCall" => Some("Bash"),
        "readToolCall" => Some("Read"),
        "writeToolCall" => Some("Write"),
        "grepToolCall" | "searchToolCall" => Some("Grep"),
        "globToolCall" | "listToolCall" | "listDirToolCall" => Some("Glob"),
        _ => None,
    }
}

fn value_at<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    Some(current)
}

fn first_string(value: &Value, paths: &[&[&str]]) -> Option<String> {
    paths.iter().find_map(|path| {
        value_at(value, path)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToOwned::to_owned)
    })
}

/// The chat id Cursor assigns, from any of the shapes it has used.
fn extract_chat_id(value: &Value) -> Option<String> {
    first_string(
        value,
        &[
            &["chat_id"],
            &["chatId"],
            &["session_id"],
            &["sessionId"],
            &["chat", "id"],
            &["session", "id"],
            &["result", "chat_id"],
            &["result", "chatId"],
            &["result", "session_id"],
            &["result", "sessionId"],
        ],
    )
}

/// Token usage from an `assistant`/`result` event, if it carries a `usage`
/// object. Cursor mirrors Claude's `snake_case` and a `camelCase` alias.
fn extract_usage(value: &Value) -> Option<TokenUsage> {
    let usage = value
        .get("usage")
        .or_else(|| value_at(value, &["result", "usage"]))?;
    TokenUsage::from_keys(
        usage,
        &TokenUsageKeys {
            input: &["input_tokens", "inputTokens"],
            output: &["output_tokens", "outputTokens"],
            cache_read: &["cache_read_input_tokens", "cacheReadInputTokens"],
            cache_creation: &["cache_creation_input_tokens", "cacheCreationInputTokens"],
        },
    )
}

/// The assistant text carried by a message's `content` block array, concatenated.
fn text_from_blocks(blocks: &[Value]) -> String {
    blocks
        .iter()
        .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .collect::<String>()
}

/// A parsed tool call: id, normalized name, and input.
struct ParsedTool {
    id: String,
    name: String,
    input: Value,
}

/// Extract a tool call from Cursor's native `tool_call` event (a single
/// `editToolCall`/`shellToolCall`/… keyed object under `tool_call`).
fn parse_native_tool(value: &Value) -> Option<ParsedTool> {
    let raw_id = value.get("call_id").and_then(Value::as_str)?;
    // Cursor sometimes suffixes the call id with the tool output after a newline.
    let id = raw_id.split('\n').next().unwrap_or(raw_id).to_string();
    let obj = value.get("tool_call").and_then(Value::as_object)?;
    let (key, data) = obj.iter().next()?;
    let name = tool_name_for(key)?.to_string();
    let mut input = data.get("args").cloned().unwrap_or(Value::Null);
    // Normalize Cursor's `path` to the `file_path` warden's file tools expect.
    if let Some(map) = input.as_object_mut() {
        if matches!(name.as_str(), "Edit" | "Read" | "Write") {
            if let Some(path) = map.remove("path") {
                map.entry("file_path").or_insert(path);
            }
        }
    }
    Some(ParsedTool { id, name, input })
}

/// The result text for a completed native tool call.
fn parse_native_tool_result(value: &Value) -> Option<(String, String)> {
    let raw_id = value.get("call_id").and_then(Value::as_str)?;
    let id = raw_id.split('\n').next().unwrap_or(raw_id).to_string();
    let obj = value.get("tool_call").and_then(Value::as_object)?;
    let (_key, data) = obj.iter().next()?;
    let result = data.get("result")?;
    let output = if let Some(success) = result.get("success") {
        success.to_string()
    } else if let Some(error) = result.get("error") {
        format!("Error: {error}")
    } else {
        result.to_string()
    };
    Some((id, output))
}

/// What a translated stream line produces. The reader turns these into live
/// deltas + persisted events; tests collect them directly.
enum Emit {
    Delta(String),
    Event(AgentEvent),
}

/// Running state across a turn's stream lines.
#[derive(Default)]
struct StreamState {
    /// The authoritative assistant text so far (Cursor sends cumulative snapshots).
    text: String,
    /// How much of `text` has already been persisted as `AssistantText`.
    flushed: usize,
    chat_id: String,
    usage: Option<TokenUsage>,
    /// Final `result` text, used when no assistant snapshot was seen.
    result_text: Option<String>,
    /// Tool-call ids already emitted, so Cursor's repeated `tool_call` events
    /// (started then completed) yield one `ToolUse` each.
    seen_tools: std::collections::HashSet<String>,
}

impl StreamState {
    /// Persist any assistant prose accumulated since the last flush, in order —
    /// called before a tool event so text-before-tool keeps its position.
    fn flush_text(&mut self, sink: &mut impl FnMut(Emit)) {
        if self.text.len() > self.flushed {
            let segment = self.text[self.flushed..].to_string();
            self.flushed = self.text.len();
            if !segment.trim().is_empty() {
                sink(Emit::Event(AgentEvent::AssistantText {
                    text: segment,
                    parent_tool_use_id: None,
                }));
            }
        }
    }

    /// Grow `text` from an incoming assistant fragment, emitting the new suffix
    /// as a live (transient) delta.
    ///
    /// `is_snapshot` distinguishes Cursor's two shapes: a cumulative message
    /// snapshot (the whole assistant text so far) versus a delta fragment (only
    /// the newest chunk). Snapshots are deduped by *prefix continuation* — a
    /// re-sent equal or shorter snapshot adds nothing — but a delta is always
    /// new content and is appended verbatim, even when it repeats text seen
    /// earlier in the turn. (An earlier global `contains()` check silently
    /// dropped any delta that happened to be a substring of the accumulated
    /// text, losing legitimately repeated content.)
    fn extend_text(&mut self, incoming: &str, is_snapshot: bool, sink: &mut impl FnMut(Emit)) {
        if incoming.is_empty() {
            return;
        }
        if self.text.is_empty() {
            self.text.push_str(incoming);
            sink(Emit::Delta(incoming.to_string()));
            return;
        }
        if !is_snapshot {
            // A delta is inherently new: append it and emit it, no dedup.
            self.text.push_str(incoming);
            sink(Emit::Delta(incoming.to_string()));
            return;
        }
        if incoming.starts_with(self.text.as_str()) {
            // A cumulative snapshot that extends what we have: emit only the new tail.
            let suffix = incoming[self.text.len()..].to_string();
            if !suffix.is_empty() {
                self.text = incoming.to_string();
                sink(Emit::Delta(suffix));
            }
        } else if self.text.starts_with(incoming) {
            // A re-sent equal or shorter snapshot (a prefix of what we have) —
            // nothing new.
        } else {
            // A snapshot that diverges from the current text (a rewrite): append
            // the fragment rather than lose it.
            self.text.push_str(incoming);
            sink(Emit::Delta(incoming.to_string()));
        }
    }
}

/// Translate one parsed stream value, updating `state` and emitting deltas/events.
fn process_line(state: &mut StreamState, value: &Value, sink: &mut impl FnMut(Emit)) {
    if let Some(id) = extract_chat_id(value) {
        state.chat_id = id;
    }
    // Last-wins: the final `result` event carries the turn's cumulative totals,
    // which must not be shadowed by an early per-message `usage`. A value-less
    // event returns `None` and leaves the last good reading intact.
    if let Some(usage) = extract_usage(value) {
        state.usage = Some(usage);
    }

    match value.get("type").and_then(Value::as_str).unwrap_or("") {
        "assistant" => {
            // Prefer a full message snapshot; fall back to a top-level delta.
            if let Some(blocks) = value_at(value, &["message", "content"]).and_then(Value::as_array)
            {
                let snapshot = text_from_blocks(blocks);
                state.extend_text(&snapshot, true, sink);
                for block in blocks {
                    if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                        if let (Some(id), Some(name)) = (
                            first_string(block, &[&["id"], &["tool_call_id"], &["toolCallId"]]),
                            first_string(block, &[&["name"], &["tool_name"], &["toolName"]]),
                        ) {
                            if state.seen_tools.insert(id.clone()) {
                                state.flush_text(sink);
                                sink(Emit::Event(AgentEvent::ToolUse {
                                    id,
                                    name,
                                    input: block
                                        .get("input")
                                        .or_else(|| block.get("args"))
                                        .cloned()
                                        .unwrap_or(Value::Null),
                                    parent_tool_use_id: None,
                                }));
                            }
                        }
                    }
                }
            } else if let Some(delta) = first_string(value, &[&["delta"], &["text"]]) {
                state.extend_text(&delta, false, sink);
            }
        }
        "tool_call" => {
            if let Some(tool) = parse_native_tool(value) {
                if state.seen_tools.insert(tool.id.clone()) {
                    state.flush_text(sink);
                    sink(Emit::Event(AgentEvent::ToolUse {
                        id: tool.id,
                        name: tool.name,
                        input: tool.input,
                        parent_tool_use_id: None,
                    }));
                }
            }
            if value.get("subtype").and_then(Value::as_str) == Some("completed") {
                if let Some((id, output)) = parse_native_tool_result(value) {
                    sink(Emit::Event(AgentEvent::ToolResult {
                        tool_use_id: id,
                        content: clip(output),
                        is_error: false,
                    }));
                }
            }
        }
        "result" => {
            if let Some(text) = value
                .get("result")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
            {
                state.result_text = Some(text.to_string());
            }
        }
        _ => {}
    }
}

/// Run one Cursor turn: spawn the process, drain its stream into persisted
/// events, then settle the session. Returns `Err` only on a hard failure (spawn
/// error, or a non-zero exit with no output) so the manager marks the session
/// errored; a normal turn persists its own terminal [`AgentEvent::Result`].
pub async fn run_turn(
    store: &Store,
    session: &Session,
    prompt: &str,
    instructions: &str,
) -> Result<()> {
    let bin = resolve_cursor();
    let resume = if session.turns > 0 {
        session.agent_session_id.clone()
    } else {
        String::new()
    };
    let message = prepend_instructions(instructions, prompt);

    let args = build_args(&session.model, session.permission_mode, &resume, &message);
    check_spawn_limits(&bin, &args)?;

    let mut cmd = Command::new(&bin);
    cmd.args(&args)
        .current_dir(&session.working_dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Agent(format!("failed to spawn cursor-agent: {e}")))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Agent("failed to capture cursor-agent stdout".to_string()))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Agent("failed to capture cursor-agent stderr".to_string()))?;
    let stderr_task = tokio::spawn(async move {
        use tokio::io::AsyncReadExt;
        let mut buf = String::new();
        let _ = stderr.read_to_string(&mut buf).await;
        buf
    });

    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let child = Arc::new(Mutex::new(child));
    TURNS.insert(
        &session.id,
        CursorTurn {
            child: child.clone(),
            cancelled: cancelled.clone(),
        },
    );

    let mut state = StreamState::default();
    let mut lines = BufReader::new(stdout).lines();
    // Persist tool events + flushed assistant text as they arrive so the
    // transcript keeps stream order; live deltas are transient UI sugar.
    loop {
        let line = match lines.next_line().await {
            Ok(Some(line)) => line,
            Ok(None) => break,
            Err(_) => break,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        let mut emits = Vec::new();
        process_line(&mut state, &value, &mut |e| emits.push(e));
        // Persist the chat id as soon as Cursor assigns it, so a cancel or crash
        // still leaves the session resumable.
        if !state.chat_id.is_empty() && state.chat_id != session.agent_session_id {
            let _ = store.set_agent_session_id(&session.id, &state.chat_id);
        }
        for emit in emits {
            match emit {
                Emit::Delta(text) => emit_delta(&session.id, &text),
                Emit::Event(event) => persist(store, &session.id, event),
            }
        }
    }

    TURNS.remove(&session.id);
    let was_cancelled = cancelled.load(std::sync::atomic::Ordering::SeqCst);
    let status = wait_for_exit(&child).await;
    let stderr_out = stderr_task.await.unwrap_or_default();

    // Flush any trailing assistant prose, then fall back to the result text when
    // no snapshot ever arrived.
    let mut trailing = Vec::new();
    state.flush_text(&mut |e| trailing.push(e));
    for emit in trailing {
        if let Emit::Event(event) = emit {
            persist(store, &session.id, event);
        }
    }
    // Decide `has_output` BEFORE draining `result_text` below: the result-text
    // fallback persists an AssistantText but never grows `state.text`, and its
    // `take()` clears `result_text`, so reading either signal afterwards would
    // wrongly report an empty turn — the standard stream-json result-only shape.
    let has_output = !state.text.trim().is_empty() || state.result_text.is_some();
    if state.text.trim().is_empty() {
        if let Some(text) = state.result_text.take() {
            emit_delta(&session.id, &text);
            persist(
                store,
                &session.id,
                AgentEvent::AssistantText {
                    text,
                    parent_tool_use_id: None,
                },
            );
        }
    }

    let ok = status.map(|s| s.success()).unwrap_or(false);
    match settle_outcome(was_cancelled, ok, has_output, &stderr_out) {
        Settle::HardError(message) => return Err(AppError::Agent(message)),
        Settle::Result { is_error, error } => {
            // A non-zero exit that still produced output must not settle as a
            // clean turn: surface the failure as an Error event, then a failed
            // Result (matching the grok/opencode process-failure path).
            if let Some(message) = error {
                persist(store, &session.id, AgentEvent::Error { message });
            }
            persist(
                store,
                &session.id,
                AgentEvent::Result {
                    is_error,
                    cost_usd: None,
                    duration_ms: None,
                    num_turns: None,
                    usage: state.usage,
                },
            );
        }
    }
    Ok(())
}

/// How a finished turn settles, derived from its exit signal and captured
/// output. Pulled out of [`run_turn`] so the failure-propagation policy is unit
/// testable.
#[derive(Debug, PartialEq)]
enum Settle {
    /// A hard failure with nothing to show the user — bubble up as `Err` so the
    /// manager marks the session errored.
    HardError(String),
    /// A terminal `Result`. `error` carries an `Error`-event message when the
    /// process failed after emitting some output.
    Result {
        is_error: bool,
        error: Option<String>,
    },
}

fn settle_outcome(was_cancelled: bool, ok: bool, has_output: bool, stderr: &str) -> Settle {
    // A deliberate cancel, or a clean exit, settles as a normal turn.
    if was_cancelled || ok {
        return Settle::Result {
            is_error: false,
            error: None,
        };
    }
    if !has_output {
        let detail = strip_ansi(stderr);
        let message = if detail.trim().is_empty() {
            "cursor-agent exited without output".to_string()
        } else {
            detail.trim().to_string()
        };
        return Settle::HardError(message);
    }
    let tail = stderr_tail(&strip_ansi(stderr));
    let message = if tail.is_empty() {
        "cursor-agent exited with a non-zero status".to_string()
    } else {
        format!("cursor-agent exited with a non-zero status: {tail}")
    };
    Settle::Result {
        is_error: true,
        error: Some(message),
    }
}

/// The trailing slice of CLI stderr — the most recent lines carry the actual
/// failure, so surface those (bounded) rather than the whole log.
fn stderr_tail(stderr: &str) -> String {
    const MAX: usize = 600;
    let trimmed = stderr.trim();
    if trimmed.len() <= MAX {
        return trimmed.to_string();
    }
    let mut start = trimmed.len() - MAX;
    while start < trimmed.len() && !trimmed.is_char_boundary(start) {
        start += 1;
    }
    format!("…{}", &trimmed[start..])
}

/// Prepend the session's assembled context to the prompt as a system block —
/// Cursor's `--print` mode takes no separate system-prompt flag.
fn prepend_instructions(instructions: &str, prompt: &str) -> String {
    if instructions.trim().is_empty() {
        prompt.to_string()
    } else {
        format!(
            "<system_instructions>\n{}\n</system_instructions>\n\n{prompt}",
            instructions.trim()
        )
    }
}

/// A single cheap Cursor call for background workflows (naming, PR drafting):
/// a throwaway `cursor-agent --print` in `ask` mode. Returns the reply text, or
/// `None` on any failure so callers fall back gracefully.
pub async fn run_oneshot(working_dir: &std::path::Path, prompt: &str) -> Option<String> {
    let bin = resolve_cursor();
    let model = raw_model(crate::model_config::fast_workflow_model(
        crate::Backend::Cursor,
    ));
    let mut cmd = Command::new(&bin);
    cmd.args([
        "--print",
        "--output-format",
        "stream-json",
        "--trust",
        "--model",
        model,
        "--",
        prompt,
    ])
    .current_dir(working_dir)
    .stdin(std::process::Stdio::null())
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped())
    .kill_on_drop(true);

    let output = match cmd.output().await {
        Ok(output) => output,
        Err(e) => {
            log::warn!("oneshot: failed to spawn cursor-agent: {e}");
            return None;
        }
    };
    if !output.status.success() {
        log::warn!(
            "oneshot: cursor-agent exited with {}: {}",
            output.status,
            strip_ansi(&String::from_utf8_lossy(&output.stderr)).trim()
        );
        return None;
    }

    let mut state = StreamState::default();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            process_line(&mut state, &value, &mut |_| {});
        }
    }
    let text = if state.text.trim().is_empty() {
        state.result_text.unwrap_or_default()
    } else {
        state.text
    };
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

/// Collect the child's exit status once its stdout has closed, polling
/// `try_wait` so the process mutex is never held across an `.await` (which would
/// make this future non-`Send`). Kills the process if it lingers.
async fn wait_for_exit(
    child: &Arc<Mutex<tokio::process::Child>>,
) -> Option<std::process::ExitStatus> {
    for _ in 0..50 {
        {
            let mut guard = child.lock().unwrap_or_else(|p| p.into_inner());
            if let Ok(Some(status)) = guard.try_wait() {
                return Some(status);
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    let mut guard = child.lock().unwrap_or_else(|p| p.into_inner());
    let _ = guard.start_kill();
    guard.try_wait().ok().flatten()
}

/// Interrupt a session's in-flight Cursor turn by killing its process. Returns
/// whether a turn was found; the drain loop then hits EOF and settles.
pub fn interrupt(session_id: &str) -> bool {
    let Some(turn) = TURNS.get_cloned(session_id) else {
        return false;
    };
    turn.cancelled
        .store(true, std::sync::atomic::Ordering::SeqCst);
    if let Ok(mut child) = turn.child.lock() {
        let _ = child.start_kill();
    }
    true
}

/// Nothing shared to tear down — each turn owns its own process (killed on drop).
pub fn kill_all() {}

/// Drop ANSI escape sequences from CLI error output.
fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for c in chars.by_ref() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(ch);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collect(stream: &str) -> (StreamState, Vec<Emit>) {
        let mut state = StreamState::default();
        let mut emits = Vec::new();
        for line in stream.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let value: Value = serde_json::from_str(trimmed).expect("valid json");
            process_line(&mut state, &value, &mut |e| emits.push(e));
        }
        (state, emits)
    }

    fn assistant_texts(emits: &[Emit]) -> Vec<String> {
        emits
            .iter()
            .filter_map(|e| match e {
                Emit::Event(AgentEvent::AssistantText { text, .. }) => Some(text.clone()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn build_args_resumes_and_passes_bare_model() {
        let args = build_args(
            "cursor/composer-2.5",
            PermissionMode::Default,
            "chat-1",
            "hi",
        );
        assert!(args.contains(&"--print".to_string()));
        let resume = args.iter().position(|a| a == "--resume").unwrap();
        assert_eq!(args[resume + 1], "chat-1");
        let model = args.iter().position(|a| a == "--model").unwrap();
        assert_eq!(args[model + 1], "composer-2.5");
        // The prompt is the trailing positional, guarded by a `--` sentinel so a
        // message starting with `-` is not parsed as flags.
        assert_eq!(args.last().unwrap(), "hi");
        assert_eq!(args[args.len() - 2], "--");
        assert!(args.contains(&"--force".to_string()));
    }

    #[test]
    fn build_args_sentinel_protects_dash_prefixed_prompt() {
        let args = build_args("cursor/auto", PermissionMode::Default, "", "--help me");
        let sentinel = args.iter().position(|a| a == "--").unwrap();
        // Everything after `--` is the prompt operand, not options.
        assert_eq!(args[sentinel + 1], "--help me");
        assert_eq!(sentinel, args.len() - 2);
    }

    #[test]
    fn build_args_plan_mode_is_read_only() {
        let args = build_args("cursor/auto", PermissionMode::Plan, "", "plan it");
        assert!(!args.contains(&"--resume".to_string()));
        let mode = args.iter().position(|a| a == "--mode").unwrap();
        assert_eq!(args[mode + 1], "plan");
    }

    #[test]
    fn stream_emits_ordered_text_tools_and_usage() {
        let stream = r#"
{"type":"system","subtype":"init","session_id":"chat-9"}
{"type":"assistant","message":{"content":[{"type":"text","text":"Reading the file."}]}}
{"type":"tool_call","subtype":"started","call_id":"t1","tool_call":{"readToolCall":{"args":{"path":"README.md"}}}}
{"type":"tool_call","subtype":"completed","call_id":"t1","tool_call":{"readToolCall":{"result":{"success":"ok"}}}}
{"type":"assistant","message":{"content":[{"type":"text","text":"Reading the file. Done."}]}}
{"type":"result","result":"Reading the file. Done.","usage":{"input_tokens":10,"output_tokens":5}}
"#;
        let (state, emits) = collect(stream);
        assert_eq!(state.chat_id, "chat-9");

        // Text before the tool is flushed first, preserving order.
        let mut order = emits.iter().filter_map(|e| match e {
            Emit::Event(AgentEvent::AssistantText { text, .. }) => Some(format!("text:{text}")),
            Emit::Event(AgentEvent::ToolUse { name, .. }) => Some(format!("tool:{name}")),
            Emit::Event(AgentEvent::ToolResult { .. }) => Some("result".to_string()),
            _ => None,
        });
        assert_eq!(order.next().as_deref(), Some("text:Reading the file."));
        assert_eq!(order.next().as_deref(), Some("tool:Read"));
        assert_eq!(order.next().as_deref(), Some("result"));

        // The tool's `path` arg is normalized to `file_path`.
        let tool_input = emits.iter().find_map(|e| match e {
            Emit::Event(AgentEvent::ToolUse { name, input, .. }) if name == "Read" => Some(input),
            _ => None,
        });
        assert_eq!(
            tool_input.unwrap().get("file_path").and_then(Value::as_str),
            Some("README.md")
        );
        assert_eq!(state.usage.as_ref().map(|u| u.output_tokens), Some(5));
    }

    #[test]
    fn cumulative_snapshots_emit_only_new_suffix_as_deltas() {
        let stream = r#"
{"type":"assistant","message":{"content":[{"type":"text","text":"Hi"}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"Hi there"}]}}
"#;
        let (state, emits) = collect(stream);
        let deltas: Vec<&str> = emits
            .iter()
            .filter_map(|e| match e {
                Emit::Delta(text) => Some(text.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(deltas, vec!["Hi", " there"]);
        assert_eq!(state.text, "Hi there");
    }

    fn deltas(emits: &[Emit]) -> Vec<String> {
        emits
            .iter()
            .filter_map(|e| match e {
                Emit::Delta(text) => Some(text.clone()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn result_only_text_becomes_assistant_message() {
        let stream = r#"
{"type":"result","result":"Plan:\n- step one","chat_id":"chat-2"}
"#;
        let (state, _) = collect(stream);
        assert_eq!(state.result_text.as_deref(), Some("Plan:\n- step one"));
        assert!(state.text.is_empty());
        assert_eq!(state.chat_id, "chat-2");
        // No snapshot text means the reader falls back to result_text (see run_turn).
        let mut final_emits = Vec::new();
        let mut s = state;
        s.flush_text(&mut |e| final_emits.push(e));
        assert!(assistant_texts(&final_emits).is_empty());
    }

    #[test]
    fn delta_repeated_content_is_not_dropped() {
        // Two identical delta fragments are both legitimately new content; the
        // old global `contains()` dedup silently dropped the second.
        let stream = r#"
{"type":"assistant","delta":"Retrying."}
{"type":"assistant","delta":"Retrying."}
"#;
        let (state, emits) = collect(stream);
        assert_eq!(deltas(&emits), vec!["Retrying.", "Retrying."]);
        assert_eq!(state.text, "Retrying.Retrying.");
    }

    #[test]
    fn delta_substring_of_accumulated_text_is_kept() {
        // A delta that happens to be a substring of the accumulated text (but not
        // a prefix continuation) must still be appended, not swallowed.
        let stream = r#"
{"type":"assistant","delta":"abcdef"}
{"type":"assistant","delta":"cd"}
"#;
        let (state, emits) = collect(stream);
        assert_eq!(deltas(&emits), vec!["abcdef", "cd"]);
        assert_eq!(state.text, "abcdefcd");
    }

    #[test]
    fn resent_shorter_snapshot_is_deduped() {
        // A re-sent equal-or-shorter cumulative snapshot (a prefix of what we
        // have) adds nothing — only genuine growth emits a delta.
        let stream = r#"
{"type":"assistant","message":{"content":[{"type":"text","text":"Hello world"}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"Hello world"}]}}
"#;
        let (state, emits) = collect(stream);
        assert_eq!(deltas(&emits), vec!["Hello world"]);
        assert_eq!(state.text, "Hello world");
    }

    #[test]
    fn usage_prefers_last_report() {
        // An early per-message usage must not shadow the final cumulative totals.
        let stream = r#"
{"type":"assistant","message":{"content":[{"type":"text","text":"Working"}]},"usage":{"input_tokens":10,"output_tokens":2}}
{"type":"result","result":"Working","usage":{"input_tokens":10,"output_tokens":40}}
"#;
        let (state, _) = collect(stream);
        assert_eq!(state.usage.as_ref().map(|u| u.output_tokens), Some(40));
    }

    #[test]
    fn nonzero_exit_after_output_settles_as_error() {
        let outcome = settle_outcome(false, false, true, "boom: something failed\n");
        match outcome {
            Settle::Result { is_error, error } => {
                assert!(is_error);
                let message = error.expect("failed exit surfaces an Error message");
                assert!(message.contains("non-zero status"));
                assert!(message.contains("boom: something failed"));
            }
            other => panic!("expected a failed Result, got {other:?}"),
        }
    }

    #[test]
    fn result_only_nonzero_exit_settles_as_error_not_hard_error() {
        // The stream-json failure shape: the only output is the `result` event's
        // text (no assistant snapshot), and the process exits non-zero. `run_turn`
        // must compute `has_output` from `result_text` BEFORE the fallback `take()`
        // drains it — otherwise the turn wrongly settles as a HardError claiming no
        // output, dropping usage and the failed Result.
        let stream = r#"
{"type":"result","result":"partial answer","chat_id":"chat-7","usage":{"input_tokens":10,"output_tokens":3}}
"#;
        let (mut state, _) = collect(stream);
        assert!(state.text.trim().is_empty());
        assert!(state.result_text.is_some());
        assert!(state.usage.is_some());

        // Mirror run_turn's tail ordering: read the output signal, then drain.
        let has_output = !state.text.trim().is_empty() || state.result_text.is_some();
        let _ = state.result_text.take();
        assert!(has_output, "result-only turn produced output");

        match settle_outcome(false, false, has_output, "boom: crashed after result\n") {
            Settle::Result { is_error, error } => {
                assert!(is_error);
                let message = error.expect("failed exit surfaces an Error message");
                assert!(message.contains("non-zero status"));
                assert!(message.contains("boom: crashed after result"));
            }
            other => panic!("expected a failed Result, got {other:?}"),
        }
    }

    #[test]
    fn nonzero_exit_without_output_is_hard_error() {
        let outcome = settle_outcome(false, false, false, "fatal: no such model\n");
        assert_eq!(
            outcome,
            Settle::HardError("fatal: no such model".to_string())
        );
    }

    #[test]
    fn cancelled_and_clean_exits_settle_ok() {
        // A deliberate cancel never errors, even on a non-zero exit.
        assert_eq!(
            settle_outcome(true, false, true, "killed"),
            Settle::Result {
                is_error: false,
                error: None,
            }
        );
        // A clean exit settles as a normal turn.
        assert_eq!(
            settle_outcome(false, true, true, ""),
            Settle::Result {
                is_error: false,
                error: None,
            }
        );
    }
}
