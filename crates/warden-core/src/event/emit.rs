//! Typed emit helpers — the single seam that pushes events to the webview. Each
//! reads the global sink ([`super::state`]); a no-op when built without `tauri`,
//! which is what lets every logic module emit without threading an `AppHandle`.

#[cfg(feature = "tauri")]
use tauri::Emitter;

use super::payloads::{DeltaPayload, InstallProgress, Notification};
use crate::{EventRecord, Session};

/// A persisted, ordered event was appended to a session's log.
pub const EVENT_AGENT: &str = "agent-event";
/// A transient streaming text fragment (not persisted).
pub const EVENT_DELTA: &str = "agent-delta";
/// A session's metadata changed (status, turns, cost).
pub const EVENT_SESSION: &str = "session-updated";
/// The cached Linear issue set changed (background sync reconciled new data).
pub const EVENT_LINEAR: &str = "linear-issues-changed";
/// Ask the frontend to show a user-facing notification (styled popup + sound).
pub const EVENT_NOTIFY: &str = "warden://notify-request";
/// Managed-CLI install progress.
pub const EVENT_INSTALL_PROGRESS: &str = "cli:install-progress";

fn emit<P: serde::Serialize + Clone>(name: &str, payload: P) {
    #[cfg(feature = "tauri")]
    if let Some(app) = super::state::app() {
        let _ = app.emit(name, payload);
    }
    #[cfg(not(feature = "tauri"))]
    let _ = (name, payload);
}

pub fn emit_event(record: &EventRecord) {
    emit(EVENT_AGENT, record.clone());
}

pub fn emit_delta(session_id: &str, text: &str) {
    emit(EVENT_DELTA, DeltaPayload { session_id, text });
}

pub fn emit_session(session: &Session) {
    emit(EVENT_SESSION, session.clone());
}

pub fn emit_linear_changed() {
    emit(EVENT_LINEAR, ());
}

pub fn emit_notification(notification: &Notification) {
    emit(EVENT_NOTIFY, notification.clone());
}

pub fn emit_install_progress(progress: &InstallProgress) {
    emit(EVENT_INSTALL_PROGRESS, progress.clone());
}
