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

/// Ask the frontend to show a user-facing notification (styled popup + sound).
/// Routed through the main window's notify pipeline, so per-event preference
/// toggles, sound overrides, and the native-toast fallback all still apply.
pub const EVENT_NOTIFY: &str = "warden://notify-request";

/// Mirrors the frontend `NotifyTarget` union — what clicking the toast opens.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NotifyTarget {
    Session { id: String },
    Workflow { id: String },
    Url { url: String },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    /// One of the standard event names ("sessionDone", "workflowDone",
    /// "prChecks", "linearAssigned") to gate by that preference toggle;
    /// `None` shows unconditionally.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event: Option<String>,
    /// "error" renders the destructive accent and plays the error sound.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tone: Option<String>,
    /// Force a specific sound name, overriding the tone/preference default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sound: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<NotifyTarget>,
}

pub fn emit_notification(app: &AppHandle, notification: &Notification) {
    let _ = app.emit(EVENT_NOTIFY, notification);
}
