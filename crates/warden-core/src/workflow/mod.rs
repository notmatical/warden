//! Workflow graph runtime: persist and execute user-authored cross-provider
//! agent DAGs. The graph is an opaque JSON document the React Flow editor
//! round-trips; the executor reads `kind`/`edges` and ignores `position`.
//!
//! - `types` — the definition + run domain types (the type layer).
//! - `events` — the run-level DTO + emit helper the UI listens on.
//! - `executor` — the DAG scheduler that drives a run over one shared worktree.
//! - `service` — the de-Tauri'd CRUD + run/resume/retry/cancel bodies the shell
//!   commands call, plus the in-flight `WorkflowCancels` registry.
//! - `recipes` — the plan→code multi-agent handoff (to fold into the graph
//!   engine later).

pub mod events;
pub mod executor;
pub mod recipes;
pub mod service;
pub mod types;

pub use events::{emit_workflow_run, WorkflowRunView};
pub use recipes::{run_plan_to_code, PlanToCodeResult};
pub use service::WorkflowCancels;
pub use types::{
    AgentTaskConfig, Intent, NodeKind, NodePosition, NodeRunStatus, RunStatus, Workflow,
    WorkflowEdge, WorkflowGraph, WorkflowNode, WorkflowNodeRun, WorkflowRun,
};
