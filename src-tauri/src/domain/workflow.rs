//! Workflow graph domain types: a user-authored DAG of agent tasks (the
//! definition) and its executions (runs + per-node state). The graph is an
//! opaque JSON document the React Flow editor round-trips; the executor reads
//! `kind`/`edges` and ignores `position`.

use serde::{Deserialize, Serialize};

use crate::domain::{EffortLevel, PermissionMode, SessionRole};

/// A persisted workflow definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workflow {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub graph: WorkflowGraph,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowGraph {
    #[serde(default)]
    pub nodes: Vec<WorkflowNode>,
    #[serde(default)]
    pub edges: Vec<WorkflowEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowNode {
    pub id: String,
    #[serde(default)]
    pub label: String,
    pub kind: NodeKind,
    /// Canvas position — carried for the editor, ignored by the executor.
    #[serde(default)]
    pub position: Option<NodePosition>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct NodePosition {
    pub x: f64,
    pub y: f64,
}

/// The node's behavior. `HumanGate`/`Action` arrive in later phases.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum NodeKind {
    /// Topological root; synthesized if absent. Carries no agent.
    Start,
    /// Run an agent task (provider/model/mode/effort + prompt).
    AgentTask(AgentTaskConfig),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskConfig {
    pub model: String,
    pub permission_mode: PermissionMode,
    pub effort: EffortLevel,
    pub role: SessionRole,
    pub prompt: String,
    /// Open the worktree on a named branch (e.g. `feat/x`); else `warden/<id>`.
    #[serde(default)]
    pub branch_hint: Option<String>,
    /// Whether this node edits code (needs the shared coding worktree).
    #[serde(default)]
    pub writes_code: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowEdge {
    pub id: String,
    pub source: String,
    pub target: String,
}

/// A single execution of a workflow.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRun {
    pub id: String,
    pub workflow_id: Option<String>,
    pub project_id: String,
    pub group_id: String,
    pub status: RunStatus,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RunStatus {
    Pending,
    Running,
    Paused,
    Completed,
    Failed,
    Canceled,
}

impl RunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            RunStatus::Pending => "pending",
            RunStatus::Running => "running",
            RunStatus::Paused => "paused",
            RunStatus::Completed => "completed",
            RunStatus::Failed => "failed",
            RunStatus::Canceled => "canceled",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "pending" => RunStatus::Pending,
            "running" => RunStatus::Running,
            "paused" => RunStatus::Paused,
            "completed" => RunStatus::Completed,
            "failed" => RunStatus::Failed,
            "canceled" => RunStatus::Canceled,
            _ => return None,
        })
    }
}

/// Per-node execution state, overlaying the graph (the node's session row stays
/// the source of truth for transcript/cost/status).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowNodeRun {
    pub run_id: String,
    pub node_id: String,
    pub status: NodeRunStatus,
    pub session_id: Option<String>,
    pub output: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NodeRunStatus {
    Pending,
    Running,
    Done,
    Failed,
    Skipped,
}

impl NodeRunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            NodeRunStatus::Pending => "pending",
            NodeRunStatus::Running => "running",
            NodeRunStatus::Done => "done",
            NodeRunStatus::Failed => "failed",
            NodeRunStatus::Skipped => "skipped",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "pending" => NodeRunStatus::Pending,
            "running" => NodeRunStatus::Running,
            "done" => NodeRunStatus::Done,
            "failed" => NodeRunStatus::Failed,
            "skipped" => NodeRunStatus::Skipped,
            _ => return None,
        })
    }
}
