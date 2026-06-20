//! `warden-core` — the Tauri-agnostic core of warden: domain types, persistence,
//! git, providers, agent orchestration, and the workflow engine.
//!
//! Compiles with or without the `tauri` feature. With it on (how the desktop
//! shell builds), the global event sink emits to the webview; with it off, the
//! crate still builds — a standing test that the logic stays decoupled.

pub mod agent;
pub mod cli;
pub mod dist;
pub mod error;
pub mod event;
pub mod git;
pub mod model_config;
pub mod net;
pub mod paths;
pub mod platform;
pub mod poll;
pub mod secret;
pub mod session;
pub mod store;
pub mod util;
pub mod workflow;
pub mod workspace;

pub use agent::{Backend, EffortLevel, PermissionMode};
pub use error::{AppError, CommandResult, ErrorKind, IpcError};
pub use event::{AgentEvent, EventRecord, TokenUsage, ToolDenial};
pub use session::{
    CheckStatus, ContextSource, PrCheckCounts, Session, SessionContextSource, SessionKind,
    SessionRole, SessionStatus, SetupStatus,
};
pub use store::{AgentProc, LinearIssueRow, NewSession, Store};
pub use workflow::{
    AgentTaskConfig, Intent, NodeKind, NodeRunStatus, RunStatus, Workflow, WorkflowEdge,
    WorkflowGraph, WorkflowNode, WorkflowNodeRun, WorkflowRun,
};
pub use workspace::{Group, Label, Project, ProjectLabels};
