//! Names and typed emit helpers for the events warden pushes to the frontend.
//! The webview listens on these channels to render live agent activity.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::domain::{EventRecord, Session};

/// A persisted, ordered event was appended to a session's log.
pub const EVENT_AGENT: &str = "agent-event";
/// A transient streaming text fragment (not persisted).
pub const EVENT_DELTA: &str = "agent-delta";
/// A session's metadata changed (status, turns, cost).
pub const EVENT_SESSION: &str = "session-updated";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeltaPayload<'a> {
    session_id: &'a str,
    text: &'a str,
}

pub fn emit_event(app: &AppHandle, record: &EventRecord) {
    let _ = app.emit(EVENT_AGENT, record);
}

pub fn emit_delta(app: &AppHandle, session_id: &str, text: &str) {
    let _ = app.emit(EVENT_DELTA, DeltaPayload { session_id, text });
}

pub fn emit_session(app: &AppHandle, session: &Session) {
    let _ = app.emit(EVENT_SESSION, session);
}

/// The cached Linear issue set changed (background sync reconciled new data).
pub const EVENT_LINEAR: &str = "linear-issues-changed";

pub fn emit_linear_changed(app: &AppHandle) {
    let _ = app.emit(EVENT_LINEAR, ());
}
