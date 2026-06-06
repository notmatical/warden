use serde::Serialize;
use specta::Type;

/// Application-wide error type. Implements `Serialize` so it can cross the
/// Tauri command boundary and surface as a string on the frontend.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

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
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;

/// Serializable error for the Tauri IPC boundary. Commands return this so
/// specta can generate the TypeScript type; internally we use AppError.
#[derive(Debug, Serialize, Type)]
pub struct IpcError(String);

impl From<AppError> for IpcError {
    fn from(e: AppError) -> Self {
        IpcError(e.to_string())
    }
}

/// Result type for `#[tauri::command]` functions. The error crosses the IPC
/// boundary as a plain string; use `Result<T>` (= AppError) for internal fns.
pub type CommandResult<T> = std::result::Result<T, IpcError>;
