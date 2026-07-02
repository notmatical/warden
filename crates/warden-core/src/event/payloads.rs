//! Serializable payloads pushed to the webview. Pure data (serde), Tauri-free.

use serde::Serialize;
use strum::{EnumString, IntoStaticStr, VariantArray};

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

/// A standard app event a [`Notification`] gates on — mirrors the frontend
/// `NotifyEvent` union (`lib/notify.ts`) so the per-event preference toggles line
/// up. The alignment test pins the camelCase wire strings against drift.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, EnumString, IntoStaticStr, VariantArray)]
#[serde(rename_all = "camelCase")]
#[strum(serialize_all = "camelCase")]
pub enum NotifyEvent {
    SessionDone,
    WorkflowDone,
    PrChecks,
    LinearAssigned,
}

/// A notification's accent. `Error` renders the destructive style and plays the
/// error sound; `Default` is the normal accent. Mirrors the frontend `tone`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, EnumString, IntoStaticStr, VariantArray)]
#[serde(rename_all = "camelCase")]
#[strum(serialize_all = "camelCase")]
pub enum NotifyTone {
    Default,
    Error,
}

impl NotifyEvent {
    pub fn as_str(self) -> &'static str {
        self.into()
    }
    pub fn parse(s: &str) -> Option<Self> {
        s.parse().ok()
    }
}

impl NotifyTone {
    pub fn as_str(self) -> &'static str {
        self.into()
    }
    pub fn parse(s: &str) -> Option<Self> {
        s.parse().ok()
    }
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
    /// The standard app event to gate by its preference toggle; `None` shows
    /// unconditionally.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event: Option<NotifyEvent>,
    /// The accent and sound; `None` uses the default tone.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tone: Option<NotifyTone>,
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The enum wire strings must match the frontend's `NotifyEvent`/`tone`
    /// literals in `lib/notify.ts` exactly — that alignment is the whole point.
    #[test]
    fn notify_enum_strings_match_frontend() {
        assert_eq!(NotifyEvent::SessionDone.as_str(), "sessionDone");
        assert_eq!(NotifyEvent::WorkflowDone.as_str(), "workflowDone");
        assert_eq!(NotifyEvent::PrChecks.as_str(), "prChecks");
        assert_eq!(NotifyEvent::LinearAssigned.as_str(), "linearAssigned");
        assert_eq!(NotifyTone::Default.as_str(), "default");
        assert_eq!(NotifyTone::Error.as_str(), "error");

        for &e in NotifyEvent::VARIANTS {
            assert_eq!(
                serde_json::to_value(e).unwrap(),
                serde_json::Value::String(e.as_str().to_owned()),
            );
            assert_eq!(NotifyEvent::parse(e.as_str()), Some(e));
        }
        for &t in NotifyTone::VARIANTS {
            assert_eq!(
                serde_json::to_value(t).unwrap(),
                serde_json::Value::String(t.as_str().to_owned()),
            );
            assert_eq!(NotifyTone::parse(t.as_str()), Some(t));
        }
    }
}
