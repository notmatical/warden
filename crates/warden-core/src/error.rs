//! warden's error model. Internal logic returns `Result<T>` (= [`AppError`]);
//! commands cross the IPC boundary as the structured [`IpcError`] so the frontend
//! can branch on [`ErrorKind`] instead of substring-matching a message.

use serde::Serialize;
use specta::Type;

/// Application-wide error. `thiserror` provides `Display` and the `From`
/// conversions for `?`. It never crosses the IPC boundary directly — commands
/// convert it to [`IpcError`] at the edge.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    // Only present when built for the desktop shell; the core compiles without it.
    #[cfg(feature = "tauri")]
    #[error("tauri error: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("git error: {0}")]
    Git(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("invalid request: {0}")]
    Invalid(String),

    #[error("session is busy: a turn is already running")]
    Busy,

    #[error("agent process failed: {0}")]
    Agent(String),

    #[error("integration error: {0}")]
    Integration(String),
}

impl AppError {
    /// The stable, machine-readable kind the frontend branches on. The pure-infra
    /// variants collapse to [`ErrorKind::Internal`] (the UI just shows the
    /// message); the rest map to an actionable kind.
    pub fn kind(&self) -> ErrorKind {
        match self {
            AppError::Db(_) | AppError::Io(_) | AppError::Serde(_) => ErrorKind::Internal,
            #[cfg(feature = "tauri")]
            AppError::Tauri(_) => ErrorKind::Internal,
            AppError::Git(_) => ErrorKind::Git,
            AppError::NotFound(_) => ErrorKind::NotFound,
            AppError::Invalid(_) => ErrorKind::Invalid,
            AppError::Busy => ErrorKind::Busy,
            AppError::Agent(_) => ErrorKind::Agent,
            AppError::Integration(_) => ErrorKind::Integration,
        }
    }
}

/// Result type for internal functions.
pub type Result<T> = std::result::Result<T, AppError>;

/// A stable discriminant the frontend switches on. Driven by *what the UI does
/// about it*, not by the internal error source — so the infra variants share
/// `Internal`. Additive: new kinds append, existing ones never change meaning.
///
/// TODO(revise later): first-cut taxonomy — refine against the UI's actual
/// branches in the file-by-file overhaul (may add `NeedsAuth`/`Network`, split
/// `Integration` by provider). See docs/MONOREPO-MIGRATION.md.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    /// A turn is already running for the session.
    Busy,
    /// The requested entity does not exist.
    NotFound,
    /// The request was malformed or rejected by validation.
    Invalid,
    /// A git operation failed.
    Git,
    /// An agent process failed.
    Agent,
    /// A GitHub/Linear integration call failed.
    Integration,
    /// An internal failure (db/io/serialization/platform) — surface the message.
    Internal,
}

/// The error commands return across the IPC boundary. `kind` is machine-readable
/// for the frontend to branch on; `message` is the human-readable display string.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IpcError {
    pub kind: ErrorKind,
    pub message: String,
}

impl From<AppError> for IpcError {
    fn from(e: AppError) -> Self {
        IpcError {
            kind: e.kind(),
            message: e.to_string(),
        }
    }
}

/// Result type for `#[tauri::command]` functions: the error crosses the IPC
/// boundary as a structured [`IpcError`]. Internal functions use [`Result`].
pub type CommandResult<T> = std::result::Result<T, IpcError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipc_error_carries_kind_and_message() {
        let ipc: IpcError = AppError::Busy.into();
        assert_eq!(ipc.kind, ErrorKind::Busy);
        assert!(!ipc.message.is_empty());

        let ipc: IpcError = AppError::NotFound("session 7".into()).into();
        assert_eq!(ipc.kind, ErrorKind::NotFound);
        assert_eq!(ipc.message, "not found: session 7");

        let ipc: IpcError = AppError::Io(std::io::Error::other("disk")).into();
        assert_eq!(ipc.kind, ErrorKind::Internal);
    }
}
