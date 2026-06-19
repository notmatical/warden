//! `warden-core` — the Tauri-agnostic core of warden: domain types, persistence,
//! git, providers, agent orchestration, and the workflow engine.
//!
//! Compiles with or without the `tauri` feature. With it on (how the desktop
//! shell builds), the global event sink emits to the webview; with it off, the
//! crate still builds — a standing test that the logic stays decoupled.

pub mod event;
pub mod workspace;

pub use event::{AgentEvent, EventRecord, TokenUsage, ToolDenial};
pub use workspace::{Group, Label, Project, ProjectLabels};
