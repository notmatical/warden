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
pub mod integrations;
pub mod mcp;
pub mod mentions;
pub mod model_config;
pub mod net;
pub mod paths;
pub mod platform;
pub mod poll;
pub mod provider;
pub mod secret;
pub mod session;
pub mod store;
pub mod terminal;
pub mod util;
pub mod workflow;
pub mod workspace;

pub use agent::{AgentManager, Backend, EffortLevel, PermissionMode, TurnOutput};
pub use error::{AppError, CommandResult, ErrorKind, IpcError};
pub use event::{AgentEvent, EventRecord, TokenUsage, ToolDenial};
pub use provider::Provider;
pub use session::{
    CheckStatus, ContextSource, PrCheckCounts, Session, SessionContextSource, SessionKind,
    SessionRole, SessionStatus, SetupStatus,
};
pub use store::{AgentProc, LinearIssueRow, NewSession, Store};
pub use workflow::{
    AgentTaskConfig, Intent, NodeKind, NodeRunStatus, PlanToCodeResult, RunStatus, Workflow,
    WorkflowCancels, WorkflowEdge, WorkflowGraph, WorkflowNode, WorkflowNodeRun, WorkflowRun,
    WorkflowRunView,
};
pub use workspace::{Group, Label, Project, ProjectLabels};
