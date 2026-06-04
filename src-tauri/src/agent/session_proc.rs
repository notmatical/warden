//! Long-lived per-session agent processes.
//!
//! Each interactive session runs one persistent `claude` process in
//! bidirectional stream-json mode: user messages are written to its stdin and
//! its event stream is read continuously, so a session holds a warm
//! conversation across turns (and, later, interactive tool approvals). A turn is
//! "in flight" while the session's status is `Running`; the reader flips it back
//! to `Idle` when the CLI emits a `result`.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};

use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::mpsc;

use crate::domain::{AgentEvent, Session, SessionStatus};
use crate::error::{AppError, Result};
use crate::events::{emit_delta, emit_event, emit_session};
use crate::store::Store;

use super::claude;
use super::stream::parse_line;

struct Proc {
    /// Queued user-message lines headed for the process stdin.
    tx: mpsc::UnboundedSender<String>,
    child: Arc<Mutex<Child>>,
}

static PROCS: LazyLock<Mutex<HashMap<String, Proc>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn registry() -> std::sync::MutexGuard<'static, HashMap<String, Proc>> {
    PROCS.lock().unwrap_or_else(|p| p.into_inner())
}

pub fn is_alive(session_id: &str) -> bool {
    registry().contains_key(session_id)
}

/// Spawn the session's process if it isn't already running.
pub async fn ensure(
    app: &AppHandle,
    store: &Store,
    session: &Session,
    add_dirs: &[String],
) -> Result<()> {
    if is_alive(&session.id) {
        return Ok(());
    }

    let mut child = claude::session_command(session, add_dirs)?.spawn()?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::Agent("failed to capture agent stdin".to_string()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Agent("failed to capture agent stdout".to_string()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Agent("failed to capture agent stderr".to_string()))?;

    let (tx, rx) = mpsc::unbounded_channel::<String>();
    registry().insert(
        session.id.clone(),
        Proc {
            tx,
            child: Arc::new(Mutex::new(child)),
        },
    );

    // Stderr is drained into a shared buffer so a chatty CLI can't deadlock on a
    // full pipe, and so the reader can surface it if the process dies mid-turn.
    let stderr_buf = Arc::new(tokio::sync::Mutex::new(String::new()));
    tauri::async_runtime::spawn(drain_stderr(stderr, stderr_buf.clone()));
    tauri::async_runtime::spawn(writer_loop(stdin, rx));
    tauri::async_runtime::spawn(reader_loop(
        app.clone(),
        store.clone(),
        session.id.clone(),
        stdout,
        stderr_buf,
    ));
    Ok(())
}

/// Write a serialized user message to the session's process. The session must be
/// alive (call `ensure` first).
pub fn send(session_id: &str, line: String) -> Result<()> {
    registry()
        .get(session_id)
        .ok_or_else(|| AppError::Agent("session process is not running".to_string()))?
        .tx
        .send(line)
        .map_err(|_| AppError::Agent("session process has closed".to_string()))
}

/// Kill a session's process (cancel / delete / shutdown). Idempotent.
pub fn kill(session_id: &str) {
    if let Some(proc) = registry().remove(session_id) {
        if let Ok(mut child) = proc.child.lock() {
            let _ = child.start_kill();
        }
    }
}

/// Kill every live session process (app shutdown).
pub fn kill_all() {
    for (_, proc) in registry().drain() {
        if let Ok(mut child) = proc.child.lock() {
            let _ = child.start_kill();
        }
    }
}

async fn writer_loop(mut stdin: ChildStdin, mut rx: mpsc::UnboundedReceiver<String>) {
    while let Some(line) = rx.recv().await {
        if stdin.write_all(line.as_bytes()).await.is_err()
            || stdin.write_all(b"\n").await.is_err()
            || stdin.flush().await.is_err()
        {
            break;
        }
    }
}

async fn drain_stderr(
    mut stderr: tokio::process::ChildStderr,
    buf: Arc<tokio::sync::Mutex<String>>,
) {
    let mut s = String::new();
    let _ = stderr.read_to_string(&mut s).await;
    *buf.lock().await = s;
}

async fn reader_loop(
    app: AppHandle,
    store: Store,
    session_id: String,
    stdout: ChildStdout,
    stderr_buf: Arc<tokio::sync::Mutex<String>>,
) {
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let Some(parsed) = parse_line(&line) else {
            continue;
        };
        for event in parsed.events {
            if event.is_transient() {
                if let AgentEvent::TextDelta { text } = &event {
                    emit_delta(&app, &session_id, text);
                }
                continue;
            }
            if let Ok(record) = store.append_event(&session_id, &event) {
                emit_event(&app, &record);
            }
        }
        // A `result` line (the only carrier of cost) marks the turn's end.
        if let Some(cost) = parsed.cost_usd {
            let _ = store.record_turn(&session_id, cost);
            let _ = store.set_session_status(&session_id, SessionStatus::Idle);
            if let Ok(session) = store.get_session(&session_id) {
                emit_session(&app, &session);
            }
        }
    }

    // The process ended. If we were mid-turn (and not deliberately cancelled,
    // which sets Idle first), surface it as an error; otherwise just settle idle.
    registry().remove(&session_id);
    let was_running = matches!(
        store.get_session(&session_id).map(|s| s.status),
        Ok(SessionStatus::Running)
    );
    if was_running {
        let detail = stderr_buf.lock().await.trim().to_string();
        let message = if detail.is_empty() {
            "agent process ended unexpectedly".to_string()
        } else {
            detail
        };
        if let Ok(record) = store.append_event(&session_id, &AgentEvent::Error { message }) {
            emit_event(&app, &record);
        }
        let _ = store.set_session_status(&session_id, SessionStatus::Error);
    }
    if let Ok(session) = store.get_session(&session_id) {
        emit_session(&app, &session);
    }
}
