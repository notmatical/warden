//! Workflow graph domain types: a user-authored DAG of agent tasks (the
//! definition) and its executions (runs + per-node state). The graph is an
//! opaque JSON document the React Flow editor round-trips; the executor reads
//! `kind`/`edges` and ignores `position`. The executor itself ports later; this
//! is the type layer.

pub mod types;

pub use types::{
    AgentTaskConfig, Intent, NodeKind, NodePosition, NodeRunStatus, RunStatus, Workflow,
    WorkflowEdge, WorkflowGraph, WorkflowNode, WorkflowNodeRun, WorkflowRun,
};
