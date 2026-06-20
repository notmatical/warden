//! `warden-core` — the Tauri-agnostic core of warden: domain types, persistence,
//! git, providers, agent orchestration, and the workflow engine.
//!
//! Compiles with or without the `tauri` feature. With it on (how the desktop
//! shell builds), the global event sink emits to the webview; with it off, the
//! crate still builds — a standing test that the logic stays decoupled.

pub mod agent;
pub mod error;
pub mod event;
pub mod model_config;
pub mod paths;
pub mod platform;
pub mod session;
pub mod util;
pub mod workspace;

pub use agent::{Backend, EffortLevel, PermissionMode};
pub use error::{AppError, CommandResult, ErrorKind, IpcError};
pub use event::{AgentEvent, EventRecord, TokenUsage, ToolDenial};
pub use session::{
    CheckStatus, ContextSource, PrCheckCounts, Session, SessionContextSource, SessionKind,
    SessionRole, SessionStatus, SetupStatus,
};
pub use workspace::{Group, Label, Project, ProjectLabels};
