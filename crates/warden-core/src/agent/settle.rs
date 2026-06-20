//! Turn finalization — the one routine that applies a turn's outcome to its
//! session. Every turn path funnels through here: the Claude session-process
//! sink on a `result` line, the run-to-completion adapters (Codex, OpenCode) on
//! their terminal event, and the one-shot collector's `finalize`. Consolidates
//! the three formerly divergent settle paths into a single contract.
//!
//! Pure store + event helpers: it never dispatches back into the provider
//! registry, so the engine→provider→settle chain stays acyclic at the design
//! level even though it sits in the same crate.

use crate::event::{emit_event, emit_session};
use crate::session::SessionStatus;
use crate::store::Store;
use crate::AgentEvent;

/// How a turn ended, and what to record for it.
pub enum Outcome {
    /// The turn completed. `cost_usd` accrues to the session's running total
    /// (`0.0` for backends that don't report cost). The session settles `Idle`.
    Ok { cost_usd: f64 },
    /// The turn failed. An [`AgentEvent::Error`] carrying `message` is appended
    /// (and emitted) and the session settles `Error`.
    Failed { message: String },
}

/// Re-emit a session so the UI picks up a status/turn/cost change.
fn emit_current(store: &Store, session_id: &str) {
    if let Ok(session) = store.get_session(session_id) {
        emit_session(&session);
    }
}

/// Apply a turn's outcome to its session: accrue cost + settle `Idle` on
/// success, or append an error event + settle `Error` on failure. Always
/// re-emits the session so the UI reflects the new status/turn count/cost.
///
/// Shared by the session-process sink, the run-to-completion adapters, and the
/// one-shot `finalize`. Persistence failures are swallowed (best-effort) — the
/// status flip and the session emit must still run.
pub fn settle_turn(store: &Store, session_id: &str, outcome: Outcome) {
    match outcome {
        Outcome::Ok { cost_usd } => {
            let _ = store.record_turn(session_id, cost_usd);
            let _ = store.set_session_status(session_id, SessionStatus::Idle);
        }
        Outcome::Failed { message } => {
            if let Ok(record) = store.append_event(session_id, &AgentEvent::Error { message }) {
                emit_event(&record);
            }
            let _ = store.set_session_status(session_id, SessionStatus::Error);
        }
    }
    emit_current(store, session_id);
}

/// Persist and emit one translated event for a run-to-completion adapter
/// (Codex, OpenCode). A terminal [`AgentEvent::Result`] also settles the session
/// — accruing the turn and flipping to `Idle`/`Error`. A failed result only
/// flips status (the adapter already persisted a human-readable error event
/// before it), so no blank error is appended here.
pub fn persist_event(store: &Store, session_id: &str, event: AgentEvent) {
    let terminal = match &event {
        AgentEvent::Result { is_error, .. } => Some(*is_error),
        _ => None,
    };

    if let Ok(record) = store.append_event(session_id, &event) {
        emit_event(&record);
    }

    match terminal {
        Some(true) => {
            let _ = store.set_session_status(session_id, SessionStatus::Error);
            emit_current(store, session_id);
        }
        Some(false) => {
            let _ = store.record_turn(session_id, 0.0);
            let _ = store.set_session_status(session_id, SessionStatus::Idle);
            emit_current(store, session_id);
        }
        None => {}
    }
}

/// Persist a session status and re-emit the session — for an adapter's terminal
/// `error` notification (no `Result` follows it). Distinct from a turn settle:
/// it records no turn and appends no event of its own.
pub fn set_status(store: &Store, session_id: &str, status: SessionStatus) {
    let _ = store.set_session_status(session_id, status);
    emit_current(store, session_id);
}
