//! Serializable payloads pushed to the webview. Pure data (serde), Tauri-free.

use serde::Serialize;

/// A transient streaming text fragment for a session.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeltaPayload<'a> {
    pub session_id: &'a str,
    pub text: &'a str,
}

/// Mirrors the frontend `NotifyTarget` union — what clicking the toast opens.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NotifyTarget {
    Session { id: String },
    Workflow { id: String },
    Url { url: String },
}

/// A user-facing notification (styled popup + sound), routed through the main
/// window's notify pipeline so per-event preference toggles, sound overrides, and
/// the native-toast fallback all still apply.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    /// One of the standard event names ("sessionDone", "workflowDone", "prChecks",
    /// "linearAssigned") to gate by that preference toggle; `None` shows
    /// unconditionally.
    // TODO(revise later): promote `event` + `tone` to strum enums once the
    // notification producers port (so the full value set is visible and the
    // frontend keys can't be typo'd). Kept as String for a faithful port.
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

/// Progress for a managed-CLI install, emitted on `cli:install-progress`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub tool: String,
    pub stage: String,
    pub message: String,
    pub percent: u8,
}
