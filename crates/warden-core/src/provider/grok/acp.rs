//! Grok ACP transport: a persistent JSON-RPC 2.0 connection to `grok agent
//! stdio`, speaking the Agent Client Protocol over newline-delimited JSON.
//!
//! ACP is bidirectional — besides streaming `session/update` notifications, the
//! agent issues *requests* back to us (read a file, run a terminal command, ask
//! permission) and blocks until we answer. The generic app-server client in
//! [`crate::provider::jsonrpc`] deliberately drops server-initiated requests, so
//! Grok needs this dedicated transport that answers them inline while a turn
//! streams. One connection is pooled per warden session and killed on app
//! shutdown (Codex-style — no survival); the drain loop and event translation
//! live in [`super::agent`].

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::error::{AppError, Result};
use crate::PermissionMode;

/// Idle connections older than this are reaped when the next turn starts, so a
/// long-lived app doesn't accumulate a `grok` process per touched session.
const IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// A stalled handshake step (initialize/authenticate/session) is killed after
/// this so an unresponsive `grok` can't wedge a turn before the kill handle is
/// even useful.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(30);

/// A background one-shot drives to completion within this bound; a hung `grok`
/// is killed so the fast-workflow future resolves.
const ONESHOT_TIMEOUT: Duration = Duration::from_secs(60);

/// How often the blocking terminal waiters poll `try_wait`.
const TERMINAL_POLL: Duration = Duration::from_millis(50);

/// Shared registry of a connection's live terminal children, reachable from the
/// session's kill handle so a cancel/shutdown can stop terminal commands without
/// taking the (turn-held) connection lock.
type TerminalRegistry = Arc<Mutex<HashMap<String, Terminal>>>;

/// A shell command Grok asked us to run, and where its output accumulates.
pub(super) struct Terminal {
    child: Arc<Mutex<Child>>,
    output: Arc<Mutex<String>>,
    truncated: Arc<AtomicBool>,
}

/// One pooled ACP connection: the `grok` process, its stdio, and per-connection
/// state (the ACP session id, live terminals). Killable independently of the
/// connection lock via the shared `child` handle and `terminals` registry, so a
/// cancel can stop a turn that is blocked reading the stream or waiting on a
/// terminal command.
pub struct Connection {
    child: Arc<Mutex<Child>>,
    stdin: ChildStdin,
    reader: BufReader<ChildStdout>,
    stderr: Arc<Mutex<String>>,
    terminals: TerminalRegistry,
    /// Set on teardown/cancel so the blocking terminal waiters bail out.
    shutdown: Arc<AtomicBool>,
    /// The session's worktree root; fs writes and terminal cwds are confined to
    /// it outside Bypass mode.
    working_dir: PathBuf,
    pub acp_session_id: String,
    pub args: Vec<String>,
    /// Whether `fs.writeTextFile` was disabled at `initialize` (plan mode). Baked
    /// into the connection, so pool reuse must respect it (see `get_or_spawn`).
    read_only: bool,
    next_id: i64,
    next_terminal_id: u64,
    pub last_used: Instant,
    pub in_use: bool,
}

impl Drop for Connection {
    fn drop(&mut self) {
        teardown(&self.child, &self.terminals, &self.shutdown);
    }
}

impl Connection {
    /// The shared kill handle for this connection's process.
    pub fn child(&self) -> Arc<Mutex<Child>> {
        self.child.clone()
    }

    /// The shared terminal registry, for killing terminal children out of band.
    pub(super) fn terminals(&self) -> TerminalRegistry {
        self.terminals.clone()
    }

    /// The shutdown flag the blocking terminal waiters honour.
    pub fn shutdown(&self) -> Arc<AtomicBool> {
        self.shutdown.clone()
    }

    /// Whether the `grok` process is still running.
    pub fn is_alive(&self) -> bool {
        self.child
            .lock()
            .map(|mut c| c.try_wait().ok().flatten().is_none())
            .unwrap_or(false)
    }

    /// The captured tail of stderr, for surfacing a mid-turn death.
    pub fn stderr_tail(&self) -> String {
        self.stderr.lock().map(|s| s.clone()).unwrap_or_default()
    }

    fn take_request_id(&mut self) -> i64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    fn write_message(&mut self, value: &Value) -> Result<()> {
        match writeln!(self.stdin, "{value}") {
            Ok(()) => Ok(()),
            // During a cancel/shutdown the process is being killed, so a failed
            // write to its closed stdin is expected — don't surface it as a
            // mid-turn death (the drain loop settles via the cancelled flag).
            Err(_) if self.shutdown.load(Ordering::SeqCst) => Ok(()),
            Err(e) => Err(AppError::Agent(format!(
                "failed to write grok ACP message: {e}"
            ))),
        }
    }

    fn send_request(&mut self, id: i64, method: &str, params: Value) -> Result<()> {
        self.write_message(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }))
    }

    fn send_response(&mut self, id: &Value, result: Value) -> Result<()> {
        self.write_message(&json!({ "jsonrpc": "2.0", "id": id, "result": result }))
    }

    fn send_error(&mut self, id: &Value, message: &str) -> Result<()> {
        self.write_message(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32000, "message": message },
        }))
    }

    /// Read one message line from the agent. `None` when the stream closes.
    pub fn read_message(&mut self) -> Result<Option<Value>> {
        let mut line = String::new();
        loop {
            line.clear();
            let read = self
                .reader
                .read_line(&mut line)
                .map_err(|e| AppError::Agent(format!("failed to read grok ACP stream: {e}")))?;
            if read == 0 {
                return Ok(None);
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
                return Ok(Some(value));
            }
            // Non-JSON banner lines can precede the protocol; skip them.
        }
    }

    /// Send `session/prompt` and return the request id its terminal response carries.
    pub fn send_prompt(&mut self, message: &str) -> Result<i64> {
        let id = self.take_request_id();
        let session_id = self.acp_session_id.clone();
        self.send_request(
            id,
            "session/prompt",
            json!({
                "sessionId": session_id,
                "prompt": [{ "type": "text", "text": message }],
            }),
        )?;
        Ok(id)
    }

    /// Whether a message is a server-initiated request we must answer (has both a
    /// `method` and an `id`).
    pub fn is_client_request(value: &Value) -> bool {
        value.get("method").is_some() && value.get("id").is_some()
    }

    /// Answer one server-initiated ACP request (permission, terminal, file I/O),
    /// honouring `mode`. Plan refuses writes and command execution; outside Bypass
    /// the writable surface (fs writes, terminal cwd, permission targets) is
    /// confined to the session's worktree — mirroring Codex's `workspaceWrite`.
    pub fn handle_client_request(&mut self, request: &Value, mode: PermissionMode) -> Result<()> {
        let Some(id) = request.get("id").cloned() else {
            // A notification (method, no id) needs no answer.
            return Ok(());
        };
        let method = request.get("method").and_then(Value::as_str).unwrap_or("");
        let params = request.get("params").cloned().unwrap_or(Value::Null);
        let read_only = matches!(mode, PermissionMode::Plan);
        let confine = !matches!(mode, PermissionMode::BypassPermissions);

        match method {
            "session/request_permission" => {
                // In write-capable, confined modes refuse an ask that targets a
                // path outside the worktree so the agent gets a readable error.
                if !read_only && confine {
                    if let Some(bad) = outside_path_in_permission(&params, &self.working_dir) {
                        return self.send_error(
                            &id,
                            &format!("permission denied: path outside the workspace: {bad}"),
                        );
                    }
                }
                let Some(option) = selected_permission_option(&params, !read_only) else {
                    return self.send_error(&id, "no matching permission option");
                };
                self.send_response(
                    &id,
                    json!({ "outcome": { "outcome": "selected", "optionId": option } }),
                )
            }
            "terminal/create" => {
                if read_only {
                    return self.send_error(&id, "terminal execution is disabled in plan mode");
                }
                self.create_terminal(&id, &params, confine)
            }
            "terminal/output" => self.terminal_output(&id, &params),
            "terminal/wait_for_exit" => self.terminal_wait(&id, &params),
            "terminal/kill" => self.terminal_kill(&id, &params),
            "terminal/release" => self.terminal_release(&id, &params),
            "fs/read_text_file" | "fs/readTextFile" => self.read_text_file(&id, &params),
            "fs/write_text_file" | "fs/writeTextFile" => {
                if read_only {
                    return self.send_error(&id, "file writes are disabled in plan mode");
                }
                self.write_text_file(&id, &params, confine)
            }
            other => self.send_error(&id, &format!("unsupported grok ACP request: {other}")),
        }
    }

    fn create_terminal(&mut self, id: &Value, params: &Value, confine: bool) -> Result<()> {
        let Some(command) = params.get("command").and_then(Value::as_str) else {
            return self.send_error(id, "missing terminal command");
        };
        // Resolve the cwd once (relative cwds join to the worktree) and confine
        // that resolved path, so we launch the command in exactly the directory
        // we validated — not one string relative to warden's own cwd. A missing
        // cwd defaults to the worktree root.
        let effective_cwd = match params.get("cwd").and_then(Value::as_str) {
            Some(cwd) => {
                let resolved = resolve_against_root(&self.working_dir, Path::new(cwd));
                if confine && !resolved.starts_with(normalize_lexical(&self.working_dir)) {
                    return self
                        .send_error(id, &format!("terminal cwd is outside the workspace: {cwd}"));
                }
                resolved
            }
            None => self.working_dir.clone(),
        };
        let terminal_id = next_terminal_id(&mut self.next_terminal_id);
        let output_limit = params
            .get("outputByteLimit")
            .and_then(Value::as_u64)
            .unwrap_or(20_000)
            .clamp(1024, 200_000) as usize;

        let mut builder = shell_command(command);
        builder.current_dir(&effective_cwd);
        if let Some(env) = params.get("env").and_then(Value::as_array) {
            for entry in env {
                if let (Some(name), Some(value)) = (
                    entry.get("name").and_then(Value::as_str),
                    entry.get("value").and_then(Value::as_str),
                ) {
                    builder.env(name, value);
                }
            }
        }
        let mut child = builder
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| AppError::Agent(format!("failed to spawn grok terminal command: {e}")))?;

        let output = Arc::new(Mutex::new(String::new()));
        let truncated = Arc::new(AtomicBool::new(false));
        if let Some(stdout) = child.stdout.take() {
            spawn_reader(stdout, output.clone(), truncated.clone(), output_limit);
        }
        if let Some(stderr) = child.stderr.take() {
            spawn_reader(stderr, output.clone(), truncated.clone(), output_limit);
        }
        if let Ok(mut terminals) = self.terminals.lock() {
            terminals.insert(
                terminal_id.clone(),
                Terminal {
                    child: Arc::new(Mutex::new(child)),
                    output,
                    truncated,
                },
            );
        }
        self.send_response(id, json!({ "terminalId": terminal_id }))
    }

    fn terminal_output(&mut self, id: &Value, params: &Value) -> Result<()> {
        let Some(terminal_id) = params.get("terminalId").and_then(Value::as_str) else {
            return self.send_error(id, "missing terminalId");
        };
        let handle = self.terminals.lock().ok().and_then(|terminals| {
            terminals
                .get(terminal_id)
                .map(|t| (t.child.clone(), t.output.clone(), t.truncated.clone()))
        });
        let Some((child, output, truncated)) = handle else {
            return self.send_error(id, "unknown terminalId");
        };
        let exit_status = child
            .lock()
            .ok()
            .and_then(|mut child| child.try_wait().ok().flatten())
            .map(exit_status_json);
        let output = output.lock().map(|o| o.clone()).unwrap_or_default();
        self.send_response(
            id,
            json!({
                "output": output,
                "truncated": truncated.load(Ordering::Relaxed),
                "exitStatus": exit_status,
            }),
        )
    }

    /// Wait for a terminal to exit. Polls `try_wait` (releasing the child lock
    /// between polls) and bails on the shutdown flag, so it never blocks the drain
    /// thread indefinitely and a cancel that kills the child unwedges it promptly.
    fn terminal_wait(&mut self, id: &Value, params: &Value) -> Result<()> {
        let Some(terminal_id) = params.get("terminalId").and_then(Value::as_str) else {
            return self.send_error(id, "missing terminalId");
        };
        let child = self
            .terminals
            .lock()
            .ok()
            .and_then(|terminals| terminals.get(terminal_id).map(|t| t.child.clone()));
        let Some(child) = child else {
            return self.send_error(id, "unknown terminalId");
        };
        let shutdown = self.shutdown.clone();
        loop {
            if shutdown.load(Ordering::SeqCst) {
                return self.send_error(id, "grok terminal wait aborted");
            }
            let status = child
                .lock()
                .ok()
                .and_then(|mut child| child.try_wait().ok().flatten());
            match status {
                Some(status) => return self.send_response(id, exit_status_json(status)),
                None => std::thread::sleep(TERMINAL_POLL),
            }
        }
    }

    fn terminal_kill(&mut self, id: &Value, params: &Value) -> Result<()> {
        let Some(terminal_id) = params.get("terminalId").and_then(Value::as_str) else {
            return self.send_error(id, "missing terminalId");
        };
        if let Ok(terminals) = self.terminals.lock() {
            if let Some(terminal) = terminals.get(terminal_id) {
                if let Ok(mut child) = terminal.child.lock() {
                    let _ = child.kill();
                }
            }
        }
        self.send_response(id, json!({}))
    }

    fn terminal_release(&mut self, id: &Value, params: &Value) -> Result<()> {
        let Some(terminal_id) = params.get("terminalId").and_then(Value::as_str) else {
            return self.send_error(id, "missing terminalId");
        };
        let removed = self
            .terminals
            .lock()
            .ok()
            .and_then(|mut terminals| terminals.remove(terminal_id));
        if let Some(terminal) = removed {
            if let Ok(mut child) = terminal.child.lock() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        self.send_response(id, json!({}))
    }

    fn read_text_file(&mut self, id: &Value, params: &Value) -> Result<()> {
        let Some(path) = params.get("path").and_then(Value::as_str) else {
            return self.send_error(id, "missing path");
        };
        let content = match std::fs::read_to_string(path) {
            Ok(content) => content,
            Err(e) => return self.send_error(id, &format!("failed to read {path}: {e}")),
        };
        let line = params.get("line").and_then(Value::as_u64).unwrap_or(1);
        let limit = params.get("limit").and_then(Value::as_u64);
        let selected = if line > 1 || limit.is_some() {
            let start = line.saturating_sub(1) as usize;
            let iter = content.lines().skip(start);
            match limit {
                Some(limit) => iter.take(limit as usize).collect::<Vec<_>>().join("\n"),
                None => iter.collect::<Vec<_>>().join("\n"),
            }
        } else {
            content
        };
        self.send_response(id, json!({ "content": selected }))
    }

    fn write_text_file(&mut self, id: &Value, params: &Value, confine: bool) -> Result<()> {
        let (Some(path), Some(content)) = (
            params.get("path").and_then(Value::as_str),
            params.get("content").and_then(Value::as_str),
        ) else {
            return self.send_error(id, "missing path or content");
        };
        // Resolve once (relative paths join to the worktree) and write to that
        // resolved path — not the original string, which `std::fs::write` would
        // resolve against warden's own cwd, so the confinement check and the
        // write could disagree.
        let target = resolve_against_root(&self.working_dir, Path::new(path));
        if confine && !target.starts_with(normalize_lexical(&self.working_dir)) {
            return self.send_error(
                id,
                &format!("refusing to write outside the workspace: {path}"),
            );
        }
        match std::fs::write(&target, content) {
            Ok(()) => self.send_response(id, json!({})),
            Err(e) => self.send_error(id, &format!("failed to write {path}: {e}")),
        }
    }
}

/// The next monotonic terminal id. A counter (not `terminals.len()`) so a create
/// after a release never reuses a live id and cross-wires output.
fn next_terminal_id(counter: &mut u64) -> String {
    let id = format!("grok-terminal-{counter}");
    *counter += 1;
    id
}

/// Lexically normalize a path (fold `.` and `..`) without touching the fs, so a
/// `..`-traversal can't escape the confinement check.
fn normalize_lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Resolve `candidate` to a normalized absolute path: absolute candidates are
/// taken as-is, relative ones are joined to `root`, then `.`/`..` are folded.
/// This is the single resolution the confinement check AND the actual fs write /
/// terminal cwd must share, so what we validate is exactly what we act on.
fn resolve_against_root(root: &Path, candidate: &Path) -> PathBuf {
    let joined = if candidate.is_absolute() || candidate.has_root() {
        candidate.to_path_buf()
    } else {
        root.join(candidate)
    };
    normalize_lexical(&joined)
}

/// Whether `candidate` (absolute, or relative to `root`) resolves inside `root`
/// after folding `.`/`..`. Component-wise, so a sibling like `<root>-evil` is
/// correctly outside.
fn path_within_root(root: &Path, candidate: &Path) -> bool {
    resolve_against_root(root, candidate).starts_with(normalize_lexical(root))
}

/// The first path in a permission request's tool call that lands outside `root`,
/// if any. Best-effort — a request with no inspectable path returns `None`.
fn outside_path_in_permission(params: &Value, root: &Path) -> Option<String> {
    let tool = params.get("toolCall").or_else(|| params.get("tool_call"))?;
    let mut candidates: Vec<String> = Vec::new();
    if let Some(locations) = tool.get("locations").and_then(Value::as_array) {
        for location in locations {
            if let Some(path) = location.get("path").and_then(Value::as_str) {
                candidates.push(path.to_string());
            }
        }
    }
    if let Some(raw) = tool.get("rawInput") {
        for key in ["path", "file_path", "filePath", "cwd", "directory"] {
            if let Some(path) = raw.get(key).and_then(Value::as_str) {
                candidates.push(path.to_string());
            }
        }
    }
    candidates
        .into_iter()
        .find(|path| !path_within_root(root, Path::new(path)))
}

/// Auto-select the preferred permission option id for an allow/deny decision.
fn selected_permission_option(params: &Value, allow: bool) -> Option<String> {
    let preferred = if allow {
        ["allow_once", "allow_always"]
    } else {
        ["reject_once", "reject_always"]
    };
    let options = params.get("options").and_then(Value::as_array)?;
    preferred.iter().find_map(|kind| {
        options
            .iter()
            .find(|option| option.get("kind").and_then(Value::as_str) == Some(*kind))
            .and_then(|option| option.get("optionId").and_then(Value::as_str))
            .map(ToOwned::to_owned)
    })
}

fn exit_status_json(status: std::process::ExitStatus) -> Value {
    json!({ "exitCode": status.code(), "signal": null })
}

/// A cross-platform shell command running `command` (no console flash on Windows).
fn shell_command(command: &str) -> std::process::Command {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", command]);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = std::process::Command::new("sh");
        c.args(["-lc", command]);
        c
    };
    crate::platform::silent_command(&mut cmd);
    cmd
}

/// Trim a capped output buffer down to `limit` bytes in one bulk `drain` (on a
/// char boundary), rather than one `remove(0)` per byte (O(n^2)).
fn trim_output(out: &mut String, limit: usize, truncated: &AtomicBool) {
    if out.len() <= limit {
        return;
    }
    let mut cut = out.len() - limit;
    while cut < out.len() && !out.is_char_boundary(cut) {
        cut += 1;
    }
    out.drain(..cut);
    truncated.store(true, Ordering::Relaxed);
}

/// Stream a child pipe into a capped output buffer on a background thread.
fn spawn_reader(
    mut reader: impl Read + Send + 'static,
    output: Arc<Mutex<String>>,
    truncated: Arc<AtomicBool>,
    limit: usize,
) {
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buffer[..n]);
                    if let Ok(mut out) = output.lock() {
                        out.push_str(&text);
                        trim_output(&mut out, limit, &truncated);
                    }
                }
            }
        }
    });
}

/// Kill a connection's process and all its terminal children, and signal any
/// blocking terminal waiters to bail. `std::process::Child` does not kill on
/// drop, so this must run explicitly on every teardown path.
fn teardown(child: &Arc<Mutex<Child>>, terminals: &TerminalRegistry, shutdown: &AtomicBool) {
    shutdown.store(true, Ordering::SeqCst);
    if let Ok(mut terminals) = terminals.lock() {
        for (_, terminal) in terminals.drain() {
            if let Ok(mut child) = terminal.child.lock() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
    if let Ok(mut child) = child.lock() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

// ----- connection pool --------------------------------------------------------

static POOL: LazyLock<Mutex<HashMap<String, Arc<Mutex<Connection>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// A session's process + terminal kill handles plus a flag recording that the
/// kill was a deliberate user cancel (so the drain loop settles cleanly instead
/// of erroring).
#[derive(Clone)]
pub struct KillHandle {
    child: Arc<Mutex<Child>>,
    terminals: TerminalRegistry,
    cancelled: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
    /// Monotonic id identifying this registration, so an ending turn only clears
    /// its own handle and never a newer overlapping turn's (see `unregister_kill`).
    generation: u64,
}

impl KillHandle {
    /// Kill every live terminal child (without draining — teardown reaps them),
    /// so a blocking `terminal_wait` unwedges and the drain loop can end.
    fn kill_terminals(&self) {
        if let Ok(terminals) = self.terminals.lock() {
            for terminal in terminals.values() {
                if let Ok(mut child) = terminal.child.lock() {
                    let _ = child.kill();
                }
            }
        }
    }

    /// Kill the grok process and all its terminal children, marking the turn
    /// cancelled and signalling the terminal waiters.
    fn kill(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.shutdown.store(true, Ordering::SeqCst);
        self.kill_terminals();
        let _ = self.child.lock().map(|mut c| c.kill());
    }
}

/// Per-session kill handles, reachable without the connection lock so a cancel
/// can stop a turn that holds it for the duration of the drain loop.
static KILLS: LazyLock<Mutex<HashMap<String, KillHandle>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Source of unique registration ids for [`KillHandle`]s (turns and one-shots),
/// so an ending registration can prove identity before removing itself.
static KILL_GENERATION: AtomicU64 = AtomicU64::new(0);

/// Source of distinct pool-independent keys for one-shot kill registrations, so
/// concurrent one-shots don't collide in [`KILLS`].
static ONESHOT_SEQ: AtomicU64 = AtomicU64::new(0);

fn pool() -> std::sync::MutexGuard<'static, HashMap<String, Arc<Mutex<Connection>>>> {
    POOL.lock().unwrap_or_else(|p| p.into_inner())
}

fn kills() -> std::sync::MutexGuard<'static, HashMap<String, KillHandle>> {
    KILLS.lock().unwrap_or_else(|p| p.into_inner())
}

/// Record a session's kill handles for the duration of a turn, returning the
/// flag the drain loop reads to tell a cancel from a mid-turn death, plus the
/// registration's generation id (pass it to [`unregister_kill`]).
pub(super) fn register_kill(
    session_id: &str,
    child: Arc<Mutex<Child>>,
    terminals: TerminalRegistry,
    shutdown: Arc<AtomicBool>,
) -> (Arc<AtomicBool>, u64) {
    let cancelled = Arc::new(AtomicBool::new(false));
    let generation = KILL_GENERATION.fetch_add(1, Ordering::Relaxed);
    kills().insert(
        session_id.to_string(),
        KillHandle {
            child,
            terminals,
            cancelled: cancelled.clone(),
            shutdown,
            generation,
        },
    );
    (cancelled, generation)
}

/// Whether an unregister for `generation` should clear the currently-registered
/// handle: only when it is the same registration. An old turn whose handle was
/// already overwritten by a newer overlapping turn must not delete the new one.
fn should_unregister(registered: Option<u64>, generation: u64) -> bool {
    registered == Some(generation)
}

/// Forget a session's kill handle once its turn ends — but only if the handle is
/// still this turn's own registration (identity guard against an overlapping
/// resend that already re-registered under the same key).
pub fn unregister_kill(session_id: &str, generation: u64) {
    let mut kills = kills();
    if should_unregister(kills.get(session_id).map(|h| h.generation), generation) {
        kills.remove(session_id);
    }
}

/// Pure core of [`reusable_config`]: launch args and baked capability mode must
/// both match for a pooled connection to be reused.
fn config_matches(
    conn_args: &[String],
    conn_read_only: bool,
    args: &[String],
    read_only: bool,
) -> bool {
    conn_args == args && conn_read_only == read_only
}

/// Whether a pooled connection's launch args and baked capability mode still
/// match this turn's request (liveness is checked separately). Lets the turn
/// path revalidate a connection after locking it, not just at pool lookup.
pub(super) fn reusable_config(conn: &Connection, args: &[String], read_only: bool) -> bool {
    config_matches(&conn.args, conn.read_only, args, read_only)
}

/// The pooled connection for `session_id`, spawning + handshaking a new one when
/// there is none, the previous one died, or its launch args / baked capability
/// mode changed. Reaps idle connections for other sessions first.
pub fn get_or_spawn(
    session_id: &str,
    cli_path: &Path,
    args: Vec<String>,
    working_dir: &Path,
    resume_id: Option<&str>,
    mode: PermissionMode,
) -> Result<Arc<Mutex<Connection>>> {
    reap_idle();
    let key = session_id.to_string();
    let read_only = matches!(mode, PermissionMode::Plan);

    // Take the Arc out from under the POOL lock, then decide — never block on a
    // connection lock while holding POOL (that would wedge every other session).
    let existing = pool().get(&key).cloned();
    if let Some(existing) = existing {
        // `None` = an in-flight (or wedged) turn holds the lock; hand back the
        // same connection so the caller blocks on its lock *without* the POOL
        // guard, and `interrupt` can still kill it out of band.
        let reusable = match existing.try_lock() {
            Ok(conn) => Some(conn.is_alive() && reusable_config(&conn, &args, read_only)),
            Err(_) => None,
        };
        match reusable {
            Some(true) | None => return Ok(existing),
            Some(false) => {
                // Stale (dead / changed args / changed capability mode): tear it
                // down and fall through to spawn a fresh one. Take the Arc out
                // from under the POOL guard before locking the connection, so a
                // blocking conn.lock() never wedges every other session.
                let stale = pool().remove(&key);
                if let Some(conn) = stale {
                    if let Ok(conn) = conn.lock() {
                        kill(&conn);
                    }
                }
            }
        }
    }

    let connection = spawn(session_id, cli_path, args, working_dir, resume_id, mode)?;
    let connection = Arc::new(Mutex::new(connection));
    pool().insert(key, connection.clone());
    Ok(connection)
}

/// Remove and kill a session's pooled connection (a dead or interrupted turn).
pub fn drop_connection(session_id: &str) {
    // Release the POOL guard (temporary) before locking the connection.
    let removed = pool().remove(session_id);
    if let Some(conn) = removed {
        if let Ok(conn) = conn.lock() {
            kill(&conn);
        }
    }
}

/// Kill every pooled connection (app shutdown). Idempotent.
pub fn kill_all() {
    // Kill each live turn through its standalone handle FIRST: this unblocks any
    // drain loop parked on a read (or a terminal wait), so the connection locks
    // free up before we drain the pool.
    let handles: Vec<KillHandle> = kills().drain().map(|(_, handle)| handle).collect();
    for handle in handles {
        handle.kill();
    }
    // Collect the Arcs and release the POOL guard before locking connections.
    let conns: Vec<Arc<Mutex<Connection>>> = pool().drain().map(|(_, conn)| conn).collect();
    for conn in conns {
        if let Ok(conn) = conn.lock() {
            kill(&conn);
        }
    }
}

/// Kill a session's process (and terminal children) — reached through the
/// standalone kill handle, so it works even while the drain loop holds the
/// connection lock. The loop then hits EOF and tears the connection down.
/// Returns whether one was found.
pub fn interrupt(session_id: &str) -> bool {
    let Some(handle) = kills().get(session_id).cloned() else {
        return false;
    };
    handle.kill();
    true
}

/// Reap idle connections for other sessions. Uses `try_lock` so an in-flight
/// turn (holding a connection lock) is skipped rather than blocked on while this
/// holds the pool lock.
fn reap_idle() {
    let now = Instant::now();
    // Collect the idle Arcs and release the POOL guard before locking any
    // connection, so a blocking conn.lock() never wedges other sessions.
    let removed: Vec<Arc<Mutex<Connection>>> = {
        let mut registry = pool();
        let stale: Vec<String> = registry
            .iter()
            .filter_map(|(key, conn)| {
                let idle = conn
                    .try_lock()
                    .map(|c| !c.in_use && now.duration_since(c.last_used) >= IDLE_TIMEOUT)
                    .unwrap_or(false);
                idle.then(|| key.clone())
            })
            .collect();
        stale
            .into_iter()
            .filter_map(|key| registry.remove(&key))
            .collect()
    };
    for conn in removed {
        if let Ok(conn) = conn.lock() {
            kill(&conn);
        }
    }
}

fn kill(conn: &Connection) {
    teardown(&conn.child, &conn.terminals, &conn.shutdown);
}

/// Spawn the `grok` process and build a (not-yet-handshaked) connection.
fn build_connection(
    cli_path: &Path,
    args: Vec<String>,
    working_dir: &Path,
    resume_id: Option<&str>,
    read_only: bool,
) -> Result<Connection> {
    let mut cmd = std::process::Command::new(cli_path);
    cmd.args(&args)
        .current_dir(working_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::platform::silent_command(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Agent(format!("failed to spawn grok: {e}")))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::Agent("failed to open grok stdin".to_string()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Agent("failed to capture grok stdout".to_string()))?;
    let stderr = Arc::new(Mutex::new(String::new()));
    if let Some(mut child_stderr) = child.stderr.take() {
        let stderr = stderr.clone();
        std::thread::spawn(move || {
            let mut buf = String::new();
            let _ = child_stderr.read_to_string(&mut buf);
            if let Ok(mut slot) = stderr.lock() {
                *slot = buf;
            }
        });
    }

    Ok(Connection {
        child: Arc::new(Mutex::new(child)),
        stdin,
        reader: BufReader::new(stdout),
        stderr,
        terminals: Arc::new(Mutex::new(HashMap::new())),
        shutdown: Arc::new(AtomicBool::new(false)),
        working_dir: working_dir.to_path_buf(),
        acp_session_id: resume_id.unwrap_or_default().to_string(),
        args,
        read_only,
        next_id: 1,
        next_terminal_id: 1,
        last_used: Instant::now(),
        in_use: true,
    })
}

/// Spawn `grok agent stdio` and run the ACP handshake, returning a ready pooled
/// connection. The kill handle (process + terminals) is registered BEFORE the
/// handshake so a stalled `grok` is interruptible.
fn spawn(
    session_id: &str,
    cli_path: &Path,
    args: Vec<String>,
    working_dir: &Path,
    resume_id: Option<&str>,
    mode: PermissionMode,
) -> Result<Connection> {
    let read_only = matches!(mode, PermissionMode::Plan);
    let mut conn = build_connection(cli_path, args, working_dir, resume_id, read_only)?;
    let (_, generation) =
        register_kill(session_id, conn.child(), conn.terminals(), conn.shutdown());
    match handshake(&mut conn, working_dir, resume_id, mode) {
        Ok(()) => Ok(conn),
        Err(e) => {
            unregister_kill(session_id, generation);
            Err(e)
        }
    }
}

/// Run one background one-shot over a throwaway ACP connection: spawn `grok agent
/// stdio` (read-only), handshake, send one prompt over stdio (never argv), drain
/// the assistant text, and kill. Returns the collected reply text.
pub fn run_oneshot_blocking(
    cli_path: &Path,
    args: Vec<String>,
    working_dir: &Path,
    prompt: &str,
) -> Result<String> {
    let mut conn = build_connection(cli_path, args, working_dir, None, true)?;
    // Register under a distinct, pool-independent key so `kill_all` at shutdown
    // can stop an in-flight one-shot (its throwaway connection is in neither the
    // POOL nor keyed by any session id).
    let key = format!(
        "__grok_oneshot_{}",
        ONESHOT_SEQ.fetch_add(1, Ordering::Relaxed)
    );
    let (_, generation) = register_kill(&key, conn.child(), conn.terminals(), conn.shutdown());
    let result = drive_oneshot(&mut conn, working_dir, prompt);
    unregister_kill(&key, generation);
    result
}

fn drive_oneshot(conn: &mut Connection, working_dir: &Path, prompt: &str) -> Result<String> {
    handshake(conn, working_dir, None, PermissionMode::Plan)?;

    // Bound the whole drive: a hung grok is killed so the future resolves.
    let child = conn.child();
    let done = Arc::new(AtomicBool::new(false));
    {
        let done = done.clone();
        std::thread::spawn(move || {
            let deadline = Instant::now() + ONESHOT_TIMEOUT;
            while Instant::now() < deadline {
                if done.load(Ordering::SeqCst) {
                    return;
                }
                std::thread::sleep(TERMINAL_POLL);
            }
            let _ = child.lock().map(|mut c| c.kill());
        });
    }

    let prompt_id = conn.send_prompt(prompt)?;
    let mut text = String::new();
    loop {
        let Some(value) = conn.read_message()? else {
            break;
        };
        // Any message carrying a `method` is server-initiated (request or
        // notification) — answer requests inline, harvest text from updates.
        if value.get("method").is_some() {
            if Connection::is_client_request(&value) {
                conn.handle_client_request(&value, PermissionMode::Plan)?;
            } else {
                collect_oneshot_text(&value, &mut text);
            }
            continue;
        }
        if value.get("id").and_then(Value::as_i64) == Some(prompt_id) {
            break;
        }
    }
    done.store(true, Ordering::SeqCst);
    Ok(text.trim().to_string())
}

/// Append an `agent_message_chunk`'s text to `out` (one-shot text harvesting).
fn collect_oneshot_text(value: &Value, out: &mut String) {
    if value.get("method").and_then(Value::as_str) != Some("session/update") {
        return;
    }
    let Some(update) = value.get("params").and_then(|p| p.get("update")) else {
        return;
    };
    if update.get("sessionUpdate").and_then(Value::as_str) == Some("agent_message_chunk") {
        if let Some(text) = update
            .get("content")
            .and_then(|c| c.get("text"))
            .and_then(Value::as_str)
        {
            out.push_str(text);
        }
    }
}

fn handshake(
    conn: &mut Connection,
    working_dir: &Path,
    resume_id: Option<&str>,
    mode: PermissionMode,
) -> Result<()> {
    let read_only = matches!(mode, PermissionMode::Plan);

    let init_id = conn.take_request_id();
    conn.send_request(
        init_id,
        "initialize",
        json!({
            "protocolVersion": 1,
            "clientCapabilities": {
                "fs": { "readTextFile": true, "writeTextFile": !read_only },
                "terminal": true,
            },
        }),
    )?;
    let init = await_response(conn, init_id, mode, "initialize")?
        .get("result")
        .cloned()
        .ok_or_else(|| AppError::Agent("grok initialize returned no result".to_string()))?;

    let method_id = auth_method(&init)
        .ok_or_else(|| AppError::Agent("run `grok login` first, or set XAI_API_KEY".to_string()))?;
    let auth_id = conn.take_request_id();
    conn.send_request(
        auth_id,
        "authenticate",
        json!({ "methodId": method_id, "_meta": { "headless": true } }),
    )?;
    await_response(conn, auth_id, mode, "authenticate")?;

    let resume = resume_id.filter(|id| !id.is_empty());
    let (method, params) = match resume {
        Some(id) => (
            "session/load",
            json!({ "sessionId": id, "cwd": working_dir.to_string_lossy(), "mcpServers": [] }),
        ),
        None => (
            "session/new",
            json!({ "cwd": working_dir.to_string_lossy(), "mcpServers": [] }),
        ),
    };
    let session_id = conn.take_request_id();
    conn.send_request(session_id, method, params)?;
    let response = match await_response(conn, session_id, mode, "session") {
        Ok(response) => response,
        // A stale persisted id makes `session/load` fail forever; fall back to a
        // fresh session so the turn recovers. The new id is persisted by the
        // caller (it differs from the stored one).
        Err(_) if resume.is_some() => {
            let new_id = conn.take_request_id();
            conn.send_request(
                new_id,
                "session/new",
                json!({ "cwd": working_dir.to_string_lossy(), "mcpServers": [] }),
            )?;
            await_response(conn, new_id, mode, "session")?
        }
        Err(e) => return Err(e),
    };
    if let Some(id) = super::agent::extract_acp_session_id(&response) {
        conn.acp_session_id = id;
    }
    if conn.acp_session_id.is_empty() {
        return Err(AppError::Agent("grok returned no session id".to_string()));
    }
    Ok(())
}

/// Read until the response for `request_id`, answering any server requests that
/// arrive in the meantime, bounded by [`HANDSHAKE_TIMEOUT`] (a stalled step kills
/// the process and errors cleanly).
fn await_response(
    conn: &mut Connection,
    request_id: i64,
    mode: PermissionMode,
    context: &str,
) -> Result<Value> {
    let child = conn.child();
    let done = Arc::new(AtomicBool::new(false));
    let timed_out = Arc::new(AtomicBool::new(false));
    let watchdog = {
        let (done, timed_out) = (done.clone(), timed_out.clone());
        std::thread::spawn(move || {
            let deadline = Instant::now() + HANDSHAKE_TIMEOUT;
            while Instant::now() < deadline {
                if done.load(Ordering::SeqCst) {
                    return;
                }
                std::thread::sleep(TERMINAL_POLL);
            }
            if !done.load(Ordering::SeqCst) {
                timed_out.store(true, Ordering::SeqCst);
                let _ = child.lock().map(|mut c| c.kill());
            }
        })
    };

    let result = await_response_inner(conn, request_id, mode, context);
    done.store(true, Ordering::SeqCst);
    let _ = watchdog.join();

    if timed_out.load(Ordering::SeqCst) {
        return Err(AppError::Agent(format!("grok {context} timed out")));
    }
    result
}

fn await_response_inner(
    conn: &mut Connection,
    request_id: i64,
    mode: PermissionMode,
    context: &str,
) -> Result<Value> {
    loop {
        let Some(value) = conn.read_message()? else {
            return Err(AppError::Agent(format!(
                "grok exited before {context} completed"
            )));
        };
        match classify_await(&value, request_id) {
            // A `method` means server-initiated (request or notification), never
            // our response — even when its id collides with our pending id.
            // `handle_client_request` no-ops on a notification (no id).
            AwaitRoute::Server => conn.handle_client_request(&value, mode)?,
            AwaitRoute::Response => {
                if let Some(error) = value.get("error") {
                    return Err(AppError::Agent(format!("grok {context} failed: {error}")));
                }
                return Ok(value);
            }
            AwaitRoute::Other => {}
        }
    }
}

/// How a message read while awaiting a response should be routed.
#[derive(Debug, PartialEq, Eq)]
enum AwaitRoute {
    /// Server-initiated request or notification (has a `method`).
    Server,
    /// The terminal response for our pending request.
    Response,
    /// An unrelated response (different id) — ignored.
    Other,
}

/// Route a message read while awaiting `request_id`. A `method` always wins:
/// JSON-RPC responses never carry one, so a server request whose id happens to
/// collide with ours is still handled as a request (and answered), not
/// mis-returned as our response.
fn classify_await(value: &Value, request_id: i64) -> AwaitRoute {
    if value.get("method").is_some() {
        return AwaitRoute::Server;
    }
    if value.get("id").and_then(Value::as_i64) == Some(request_id) {
        return AwaitRoute::Response;
    }
    AwaitRoute::Other
}

/// Pick the ACP auth method: the cached login token, or the API key when
/// `XAI_API_KEY` is set and offered.
fn auth_method(init: &Value) -> Option<String> {
    let ids: Vec<&str> = init
        .get("authMethods")
        .and_then(Value::as_array)
        .map(|methods| {
            methods
                .iter()
                .filter_map(|m| m.get("id").and_then(Value::as_str))
                .collect()
        })
        .unwrap_or_default();
    let has_api_key = std::env::var("XAI_API_KEY")
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false);
    if has_api_key && ids.contains(&"xai.api_key") {
        return Some("xai.api_key".to_string());
    }
    if ids.contains(&"cached_token") {
        return Some("cached_token".to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_method_prefers_cached_token() {
        let init = json!({ "authMethods": [{ "id": "cached_token" }] });
        assert_eq!(auth_method(&init).as_deref(), Some("cached_token"));
    }

    #[test]
    fn permission_option_matches_allow_then_deny() {
        let params = json!({
            "options": [
                { "kind": "allow_once", "optionId": "a1" },
                { "kind": "reject_once", "optionId": "r1" },
            ]
        });
        assert_eq!(
            selected_permission_option(&params, true).as_deref(),
            Some("a1")
        );
        assert_eq!(
            selected_permission_option(&params, false).as_deref(),
            Some("r1")
        );
    }

    #[test]
    fn await_route_treats_method_id_collision_as_server_request() {
        // A server request whose id collides with our pending id (5) must route
        // as a server request, not be mis-returned as our response.
        let colliding = json!({
            "jsonrpc": "2.0",
            "id": 5,
            "method": "session/request_permission",
            "params": {}
        });
        assert_eq!(classify_await(&colliding, 5), AwaitRoute::Server);

        // Our actual response (matching id, no method) is the response.
        let response = json!({ "jsonrpc": "2.0", "id": 5, "result": {} });
        assert_eq!(classify_await(&response, 5), AwaitRoute::Response);

        // A different id is an unrelated response.
        let other = json!({ "jsonrpc": "2.0", "id": 9, "result": {} });
        assert_eq!(classify_await(&other, 5), AwaitRoute::Other);

        // A notification (method, no id) routes as server too.
        let note = json!({ "jsonrpc": "2.0", "method": "session/update", "params": {} });
        assert_eq!(classify_await(&note, 5), AwaitRoute::Server);
    }

    #[test]
    fn terminal_ids_are_monotonic() {
        let mut counter = 1;
        let a = next_terminal_id(&mut counter);
        let b = next_terminal_id(&mut counter);
        // Even if `a` is released (which does not decrement the counter), the
        // next id must not reuse a prior one.
        let c = next_terminal_id(&mut counter);
        assert_eq!(a, "grok-terminal-1");
        assert_eq!(b, "grok-terminal-2");
        assert_eq!(c, "grok-terminal-3");
        assert_ne!(a, c);
    }

    #[test]
    fn trim_output_bulk_caps_and_marks_truncated() {
        let truncated = AtomicBool::new(false);
        let mut out = "abcdefghij".to_string(); // 10 bytes
        trim_output(&mut out, 4, &truncated);
        assert_eq!(out, "ghij");
        assert!(truncated.load(Ordering::Relaxed));

        // Under the limit: untouched, not marked truncated.
        let untouched = AtomicBool::new(false);
        let mut small = "hi".to_string();
        trim_output(&mut small, 4, &untouched);
        assert_eq!(small, "hi");
        assert!(!untouched.load(Ordering::Relaxed));
    }

    #[test]
    fn trim_output_cuts_on_utf8_boundary() {
        // "éa" is [0xC3 0xA9] + [0x61] = 3 bytes; trimming to 2 must not split
        // the multibyte char, so the whole `é` is dropped.
        let truncated = AtomicBool::new(false);
        let mut out = "éa".to_string();
        trim_output(&mut out, 2, &truncated);
        assert_eq!(out, "a");
        assert!(truncated.load(Ordering::Relaxed));
    }

    #[test]
    fn path_within_root_inside_and_outside() {
        let root = Path::new("/work/tree");
        // Inside (absolute + relative).
        assert!(path_within_root(root, Path::new("/work/tree/src/main.rs")));
        assert!(path_within_root(root, Path::new("src/main.rs")));
        // `..` that stays inside is fine.
        assert!(path_within_root(
            root,
            Path::new("/work/tree/src/../lib.rs")
        ));
        // Outside.
        assert!(!path_within_root(root, Path::new("/etc/passwd")));
        // `..`-traversal escaping the root is refused.
        assert!(!path_within_root(root, Path::new("/work/tree/../secret")));
        assert!(!path_within_root(root, Path::new("../secret")));
        // A sibling sharing a name prefix is outside.
        assert!(!path_within_root(root, Path::new("/work/tree-evil/x")));
    }

    #[test]
    fn resolve_against_root_joins_relative_and_normalizes() {
        let root = Path::new("/work/tree");
        // A relative candidate joins to the root (not warden's cwd).
        assert_eq!(
            resolve_against_root(root, Path::new("src/main.rs")),
            PathBuf::from("/work/tree/src/main.rs")
        );
        // An absolute candidate is taken as-is (still normalized).
        assert_eq!(
            resolve_against_root(root, Path::new("/etc/passwd")),
            PathBuf::from("/etc/passwd")
        );
        // `.`/`..` are folded so the resolved path is what we act on.
        assert_eq!(
            resolve_against_root(root, Path::new("src/../lib.rs")),
            PathBuf::from("/work/tree/lib.rs")
        );
        // The resolved path is exactly what the confinement check sees, so a
        // relative escape resolves outside the root.
        assert!(!resolve_against_root(root, Path::new("../secret"))
            .starts_with(normalize_lexical(root)));
    }

    #[test]
    fn config_matches_requires_args_and_mode() {
        let args = vec!["agent".to_string(), "stdio".to_string()];
        assert!(config_matches(&args, false, &args, false));
        // Different capability mode -> not reusable.
        assert!(!config_matches(&args, true, &args, false));
        // Different launch args -> not reusable.
        let other = vec!["agent".to_string(), "--model".to_string()];
        assert!(!config_matches(&args, false, &other, false));
    }

    #[test]
    fn should_unregister_only_matches_own_generation() {
        // The currently-registered generation may only be cleared by its own
        // unregister — an older overlapping turn (gen 1) must not delete gen 2.
        assert!(should_unregister(Some(2), 2));
        assert!(!should_unregister(Some(2), 1));
        // Nothing registered -> nothing to clear.
        assert!(!should_unregister(None, 1));
    }

    #[test]
    fn permission_outside_path_detected() {
        let root = Path::new("/work/tree");
        let inside = json!({
            "toolCall": { "rawInput": { "path": "/work/tree/src/a.rs" } }
        });
        assert_eq!(outside_path_in_permission(&inside, root), None);

        let outside = json!({
            "toolCall": { "locations": [{ "path": "/etc/hosts" }] }
        });
        assert_eq!(
            outside_path_in_permission(&outside, root).as_deref(),
            Some("/etc/hosts")
        );

        // No inspectable path -> no denial signal.
        let opaque = json!({ "options": [] });
        assert_eq!(outside_path_in_permission(&opaque, root), None);
    }
}
