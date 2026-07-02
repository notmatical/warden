//! Long-lived per-session agent processes, built to survive the app.
//!
//! Each interactive session runs one persistent `claude` process in
//! bidirectional stream-json mode: user messages are written to its stdin and
//! its event stream is read continuously, so a session holds a warm
//! conversation across turns. A turn is "in flight" while the session's status
//! is `Running`; the tailer flips it back to `Idle` when the CLI emits a
//! `result`.
//!
//! The process writes stdout/stderr to per-spawn files instead of pipes and is
//! spawned detached, so closing (or crashing) warden does not kill it: the CLI
//! sees stdin EOF, finishes the in-flight turn into the file, and exits on its
//! own. A registry row (`agent_procs`) records pid + output file + drained
//! offset; on the next launch [`recover`] re-tails a live process's file or
//! drains a dead one's remainder into the event log, so the turn's work is
//! never lost. Event appends and offset advances commit atomically, so a replay
//! after a hard crash neither drops nor duplicates events.

use std::collections::{HashMap, HashSet};
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin};
use tokio::sync::mpsc;

use crate::event::{emit_delta, emit_event, emit_session};
use crate::session::{Session, SessionStatus};
use crate::store::{AgentProc, Store};
use crate::util::{now_rfc3339, uuid};
use crate::{paths, AgentEvent, TokenUsage};

use super::stream::parse_line;
use crate::provider::claude::agent as claude;

/// Shown in the timeline when a turn's process died before its `result` —
/// typically the app closed mid-turn and the CLI couldn't finish offline.
const INTERRUPTED_NOTICE: &str =
    "Turn interrupted — the app closed before this turn finished. Send a message to continue.";

struct Proc {
    /// Spawn generation; guards registry/DB cleanup against a newer respawn.
    proc_id: String,
    /// Queued user-message lines headed for the process stdin.
    tx: mpsc::UnboundedSender<String>,
    child: Arc<Mutex<Child>>,
    /// OS pid of the spawned process, for tree-killing its descendants (the
    /// Windows `claude.cmd` shim spawns `node`, which `start_kill` would orphan).
    pid: Option<u32>,
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
    store: &Store,
    session: &Session,
    add_dirs: &[String],
    context_file: Option<&str>,
) -> crate::error::Result<()> {
    if is_alive(&session.id) {
        return Ok(());
    }

    // Resume if Claude already created this session (its log carries an init), so
    // a cancelled first turn — which never recorded a turn — doesn't re-run
    // `--session-id` on an existing id and fail with "already in use".
    let resume = store
        .list_events(&session.id)
        .map(|events| {
            events
                .iter()
                .any(|e| matches!(e.event, AgentEvent::SessionInit { .. }))
        })
        .unwrap_or(false);

    let proc_id = uuid();
    let dir = paths::session_dir(&session.id)?;
    let out_path = dir.join(format!("out-{proc_id}.jsonl"));
    let err_path = dir.join(format!("err-{proc_id}.log"));
    let out_file = std::fs::File::create(&out_path)
        .map_err(|e| crate::error::AppError::Agent(e.to_string()))?;
    let err_file = std::fs::File::create(&err_path)
        .map_err(|e| crate::error::AppError::Agent(e.to_string()))?;

    let mut cmd = claude::session_command(session, add_dirs, context_file, resume)?;
    cmd.stdout(Stdio::from(out_file))
        .stderr(Stdio::from(err_file));
    crate::platform::detach_command(&mut cmd);

    let mut child = cmd.spawn()?;
    let pid = child.id();
    let stdin = child.stdin.take().ok_or_else(|| {
        crate::error::AppError::Agent("failed to capture agent stdin".to_string())
    })?;

    store.upsert_agent_proc(&AgentProc {
        session_id: session.id.clone(),
        proc_id: proc_id.clone(),
        pid: pid.unwrap_or(0),
        out_file: out_path.to_string_lossy().into_owned(),
        err_file: err_path.to_string_lossy().into_owned(),
        out_offset: 0,
        spawned_at: now_rfc3339(),
    })?;

    let child = Arc::new(Mutex::new(child));
    let (tx, rx) = mpsc::unbounded_channel::<String>();
    registry().insert(
        session.id.clone(),
        Proc {
            proc_id: proc_id.clone(),
            tx,
            child: child.clone(),
            pid,
        },
    );

    tokio::spawn(writer_loop(stdin, rx));
    tokio::spawn(tail_session(Tail {
        store: store.clone(),
        session_id: session.id.clone(),
        proc_id,
        out_path,
        err_path,
        offset: 0,
        liveness: Liveness::Child(child),
        recovered: false,
    }));
    Ok(())
}

/// Write a serialized user message to the session's process. The session must be
/// alive (call `ensure` first).
pub fn send(session_id: &str, line: String) -> crate::error::Result<()> {
    registry()
        .get(session_id)
        .ok_or_else(|| crate::error::AppError::Agent("session process is not running".to_string()))?
        .tx
        .send(line)
        .map_err(|_| crate::error::AppError::Agent("session process has closed".to_string()))
}

/// Kill a session's process *and its descendants* (cancel / delete / settings
/// respawn). Tree-killing matters on Windows, where the `claude.cmd` shim spawns
/// `node`: `start_kill` alone would leave `node` streaming and holding the
/// session lock. Idempotent. The tailer notices the death and cleans up the
/// registry row and output files.
pub fn kill(session_id: &str) {
    if let Some(proc) = registry().remove(session_id) {
        terminate(&proc);
    }
}

fn terminate(proc: &Proc) {
    if let Some(pid) = proc.pid {
        crate::platform::process::kill_process_tree(pid);
    }
    if let Ok(mut child) = proc.child.lock() {
        let _ = child.start_kill();
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

// ----- output tailing ---------------------------------------------------

/// How the tailer decides the process is gone: a `Child` handle for processes
/// we spawned this run, a bare pid probe for ones adopted from a previous run,
/// or already-dead (drain the file and settle).
enum Liveness {
    Child(Arc<Mutex<Child>>),
    Pid(u32),
    Dead,
}

impl Liveness {
    fn is_dead(&mut self) -> bool {
        match self {
            Liveness::Child(child) => match child.lock() {
                Ok(mut c) => matches!(c.try_wait(), Ok(Some(_)) | Err(_)),
                Err(_) => true,
            },
            Liveness::Pid(pid) => !crate::platform::process::process_alive(*pid),
            Liveness::Dead => true,
        }
    }
}

struct Tail {
    store: Store,
    session_id: String,
    proc_id: String,
    out_path: PathBuf,
    err_path: PathBuf,
    offset: u64,
    liveness: Liveness,
    /// Adopted from a previous app run: we hold no stdin, so the process is
    /// reaped at turn end, and a death without a `result` settles as an
    /// interruption rather than an error.
    recovered: bool,
}

/// Follow a session process's output file from `offset`, feeding complete lines
/// into the event log until the process dies, then settle and clean up.
async fn tail_session(mut tail: Tail) {
    let mut sink = EventSink {
        store: tail.store.clone(),
        session_id: tail.session_id.clone(),
        proc_id: tail.proc_id.clone(),
        latest_usage: None,
        kill_pid_on_turn_end: match (&tail.liveness, tail.recovered) {
            (Liveness::Pid(pid), true) => Some(*pid),
            _ => None,
        },
    };

    if let Ok(mut file) = tokio::fs::File::open(&tail.out_path).await {
        let mut offset = tail.offset;
        if file.seek(SeekFrom::Start(offset)).await.is_ok() {
            let mut pending: Vec<u8> = Vec::new();
            let mut buf = vec![0u8; 16384];
            // Liveness probes shell out for adopted pids, so only check after a
            // couple of quiet polls; fresh data is itself proof of life.
            let mut quiet_polls = 0u32;
            loop {
                let n = file.read(&mut buf).await.unwrap_or(0);
                if n > 0 {
                    quiet_polls = 0;
                    pending.extend_from_slice(&buf[..n]);
                    offset = consume_lines(&mut sink, &mut pending, offset);
                    continue;
                }
                quiet_polls += 1;
                if quiet_polls >= 3 && tail.liveness.is_dead() {
                    // Catch anything flushed between the last read and death.
                    // A trailing partial line is a torn write — discard it.
                    loop {
                        let n = file.read(&mut buf).await.unwrap_or(0);
                        if n == 0 {
                            break;
                        }
                        pending.extend_from_slice(&buf[..n]);
                        offset = consume_lines(&mut sink, &mut pending, offset);
                    }
                    break;
                }
                tokio::time::sleep(Duration::from_millis(120)).await;
            }
        }
    }

    settle_and_cleanup(&tail).await;
}

/// Process every complete line in `pending`, returning the new file offset.
fn consume_lines(sink: &mut EventSink, pending: &mut Vec<u8>, mut offset: u64) -> u64 {
    while let Some(pos) = pending.iter().position(|&b| b == b'\n') {
        let line_bytes: Vec<u8> = pending.drain(..=pos).collect();
        offset += line_bytes.len() as u64;
        let line = String::from_utf8_lossy(&line_bytes);
        sink.handle_line(line.trim_end_matches(['\r', '\n']), offset);
    }
    offset
}

/// The process is gone and its file fully drained: drop the registry entry,
/// settle the session's status, and remove this generation's row + files. All
/// of it generation-guarded so a respawn that already replaced us is untouched.
async fn settle_and_cleanup(tail: &Tail) {
    {
        let mut reg = registry();
        if reg
            .get(&tail.session_id)
            .map(|p| p.proc_id == tail.proc_id)
            .unwrap_or(false)
        {
            reg.remove(&tail.session_id);
        }
    }

    let current = tail
        .store
        .agent_proc_current(&tail.session_id, &tail.proc_id)
        .unwrap_or(false);
    if current {
        let was_running = matches!(
            tail.store.get_session(&tail.session_id).map(|s| s.status),
            Ok(SessionStatus::Running)
        );
        // Died mid-turn. A deliberate cancel settles Idle before killing, so
        // `Running` here means the process ended on its own: an adopted process
        // was interrupted (expected — the previous app run closed on it), while
        // one we spawned this run crashed (surface its stderr).
        if was_running {
            if tail.recovered {
                let _ = tail.store.append_event(
                    &tail.session_id,
                    &AgentEvent::Notice {
                        text: INTERRUPTED_NOTICE.to_string(),
                    },
                );
                let _ = tail
                    .store
                    .set_session_status(&tail.session_id, SessionStatus::Idle);
            } else {
                let detail = err_tail(&tail.err_path);
                let message = if detail.is_empty() {
                    "agent process ended unexpectedly".to_string()
                } else {
                    detail
                };
                if let Ok(record) = tail
                    .store
                    .append_event(&tail.session_id, &AgentEvent::Error { message })
                {
                    emit_event(&record);
                }
                let _ = tail
                    .store
                    .set_session_status(&tail.session_id, SessionStatus::Error);
            }
        }
        let _ = tail
            .store
            .delete_agent_proc(&tail.session_id, &tail.proc_id);
        if let Ok(session) = tail.store.get_session(&tail.session_id) {
            emit_session(&session);
        }
    }

    // Every event is in SQLite now; the spill files have served their purpose.
    let _ = tokio::fs::remove_file(&tail.out_path).await;
    let _ = tokio::fs::remove_file(&tail.err_path).await;
}

/// The last ~2KB of the process's stderr file, for error surfacing.
fn err_tail(path: &Path) -> String {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let trimmed = text.trim();
    match trimmed.char_indices().nth_back(2000) {
        Some((idx, _)) => trimmed[idx..].to_string(),
        None => trimmed.to_string(),
    }
}

/// Translates one stream-json line into persisted events and status changes.
/// Shared by live tailing and recovery drains.
struct EventSink {
    store: Store,
    session_id: String,
    proc_id: String,
    /// The latest assistant message's usage — the context-window fill — which we
    /// stamp onto the turn's `result` event when it arrives.
    latest_usage: Option<TokenUsage>,
    /// An adopted process holds no stdin we could reuse, and a respawn would
    /// collide with it on the provider's session lock — so reap it the moment
    /// its turn completes, before settling Idle invites the next message.
    kill_pid_on_turn_end: Option<u32>,
}

impl EventSink {
    fn handle_line(&mut self, line: &str, offset_after: u64) {
        let Some(parsed) = parse_line(line) else {
            return;
        };
        if parsed.usage.is_some() {
            self.latest_usage = parsed.usage.clone();
        }
        let mut to_persist = Vec::new();
        for event in parsed.events {
            if event.is_transient() {
                if let AgentEvent::TextDelta { text } = &event {
                    emit_delta(&self.session_id, text);
                }
                continue;
            }
            let event = match event {
                AgentEvent::Result {
                    is_error,
                    cost_usd,
                    duration_ms,
                    num_turns,
                    usage,
                } => AgentEvent::Result {
                    is_error,
                    cost_usd,
                    duration_ms,
                    num_turns,
                    // Prefer the last assistant message's usage; fall back to the
                    // result line's own usage if that's all the CLI reported.
                    usage: self.latest_usage.clone().or(usage),
                },
                other => other,
            };
            to_persist.push(event);
        }
        if !to_persist.is_empty() {
            // Events and the drained-offset advance commit atomically, so a
            // crash-then-replay neither loses nor duplicates events.
            if let Ok(records) = self.store.append_events_with_offset(
                &self.session_id,
                &self.proc_id,
                &to_persist,
                offset_after,
            ) {
                for record in &records {
                    emit_event(record);
                }
            }
        }

        // A `result` line (the only carrier of cost) marks the turn's end.
        if let Some(cost) = parsed.cost_usd {
            if let Some(pid) = self.kill_pid_on_turn_end.take() {
                crate::platform::process::kill_process_tree(pid);
            }
            if self
                .store
                .agent_proc_current(&self.session_id, &self.proc_id)
                .unwrap_or(false)
            {
                // The terminal `result` settles the turn (accrue cost, go idle)
                // through the shared finalize routine.
                super::settle::settle_turn(
                    &self.store,
                    &self.session_id,
                    super::settle::Outcome::Ok { cost_usd: cost },
                );
            }
        }
    }
}

// ----- startup recovery ---------------------------------------------------

/// Names a registered pid may legitimately resolve to. The `claude.cmd` shim
/// makes the registered pid `cmd.exe` on Windows; the CLI itself runs on node
/// (or as a native binary). Anything else means the pid was reused.
fn plausible_agent(name: &str) -> bool {
    let name = name.to_lowercase();
    ["claude", "node", "cmd", "bun"]
        .iter()
        .any(|p| name.contains(p))
}

/// Reconcile reality with the registry on launch: re-tail processes that
/// survived the previous app run, drain the output of ones that died (their
/// turn may have completed offline), and settle any session left lying
/// `Running` with nothing behind it.
pub async fn recover(store: Store) {
    let procs = store.list_agent_procs().unwrap_or_default();
    let mut tracked: HashSet<String> = HashSet::new();
    for row in procs {
        tracked.insert(row.session_id.clone());
        let Ok(session) = store.get_session(&row.session_id) else {
            let _ = store.delete_agent_proc(&row.session_id, &row.proc_id);
            continue;
        };
        let alive = crate::platform::process::process_name(row.pid)
            .map(|name| plausible_agent(&name))
            .unwrap_or(false);
        // A survivor we can't message (its stdin died with the previous app
        // run) is only worth keeping while it finishes a turn; an idle one
        // is reaped so a respawn can't collide on the session lock.
        let liveness = if alive && session.status == SessionStatus::Running {
            Liveness::Pid(row.pid)
        } else {
            if alive {
                crate::platform::process::kill_process_tree(row.pid);
            }
            Liveness::Dead
        };
        log::info!(
            "recovering agent proc for session {}: pid {} ({})",
            row.session_id,
            row.pid,
            match liveness {
                Liveness::Pid(_) => "alive, re-tailing",
                _ => "gone, draining output",
            }
        );
        tokio::spawn(tail_session(Tail {
            store: store.clone(),
            session_id: row.session_id,
            proc_id: row.proc_id,
            out_path: PathBuf::from(row.out_file),
            err_path: PathBuf::from(row.err_file),
            offset: row.out_offset,
            liveness,
            recovered: true,
        }));
    }

    // Sessions stuck `Running` with no proc row: Codex turns (the shared
    // app-server died with the app), one-shot recipe runs, or pre-registry
    // rows. Nothing to drain — settle them honestly.
    for session in store.list_running_sessions().unwrap_or_default() {
        if tracked.contains(&session.id) {
            continue;
        }
        let _ = store.append_event(
            &session.id,
            &AgentEvent::Notice {
                text: INTERRUPTED_NOTICE.to_string(),
            },
        );
        let _ = store.set_session_status(&session.id, SessionStatus::Idle);
        if let Ok(updated) = store.get_session(&session.id) {
            emit_session(&updated);
        }
    }
}
