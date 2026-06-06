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

/// The node's behavior.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum NodeKind {
    /// Topological root; synthesized if absent. Carries no agent.
    Start,
    /// Run an agent task — its `intent` defines what it does.
    AgentTask(AgentTaskConfig),
    /// Pause the run for human approval.
    Gate(GateConfig),
}

/// What an agent node does. The intent carries a built-in instruction and the
/// right read/write posture, so downstream nodes need no hand-written task —
/// the edge supplies the content (the upstream plan/review/diff as context).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Intent {
    /// Research + produce an implementation plan (read-only).
    Plan,
    /// Implement the upstream plan (edits code).
    Code,
    /// Review the worktree diff and report issues (read-only).
    Review,
    /// Apply the upstream review's feedback (edits code).
    Revise,
    /// Free-form agent — the prompt is the whole task (default for legacy data).
    #[default]
    Custom,
}

impl Intent {
    /// The permission posture this intent runs under.
    pub fn permission_mode(self) -> PermissionMode {
        match self {
            Intent::Plan | Intent::Review => PermissionMode::Plan,
            Intent::Code | Intent::Revise => PermissionMode::BypassPermissions,
            Intent::Custom => PermissionMode::AcceptEdits,
        }
    }

    pub fn role(self) -> SessionRole {
        match self {
            Intent::Plan => SessionRole::Planner,
            Intent::Code | Intent::Revise => SessionRole::Coder,
            Intent::Review | Intent::Custom => SessionRole::Chat,
        }
    }

    pub fn writes_code(self) -> bool {
        matches!(self, Intent::Code | Intent::Revise | Intent::Custom)
    }

    /// Whether the node should be handed the worktree diff as context.
    pub fn needs_diff(self) -> bool {
        matches!(self, Intent::Review | Intent::Revise)
    }

    /// The built-in instruction for this intent (the upstream content arrives
    /// separately as injected context).
    pub fn template(self) -> &'static str {
        match self {
            Intent::Plan => {
                "Research the codebase and produce a detailed, step-by-step \
                 implementation plan for the following. Do not write code — output \
                 the plan only.\n\n"
            }
            Intent::Code => {
                "Implement the plan provided in your context. Write the code, \
                 following the plan precisely."
            }
            Intent::Review => {
                "Review the code changes shown in the diff in your context for \
                 correctness, bugs, and quality. List concrete issues and suggested \
                 fixes. Do not edit code — output the review only."
            }
            Intent::Revise => {
                "Apply the review feedback provided in your context: make the \
                 suggested improvements to the code."
            }
            Intent::Custom => "",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskConfig {
    #[serde(default)]
    pub intent: Intent,
    pub model: String,
    pub effort: EffortLevel,
    /// The feature description (Plan/Custom) or optional extra instructions.
    #[serde(default)]
    pub prompt: String,
    /// Open the per-run worktree on a named branch; else `wf/<run>`.
    #[serde(default)]
    pub branch_hint: Option<String>,
    /// Mode override (mainly for `Custom`); otherwise derived from the intent.
    #[serde(default)]
    pub permission_mode: Option<PermissionMode>,
}

impl AgentTaskConfig {
    pub fn effective_mode(&self) -> PermissionMode {
        self.permission_mode
            .unwrap_or_else(|| self.intent.permission_mode())
    }

    pub fn writes_code(&self) -> bool {
        self.intent.writes_code()
    }

    /// The prompt sent to the agent: the intent's template plus the user's text
    /// (the feature for Plan/Custom, optional extra instructions otherwise).
    pub fn effective_prompt(&self) -> String {
        let extra = self.prompt.trim();
        let base = self.intent.template();
        match self.intent {
            Intent::Custom => {
                if extra.is_empty() {
                    "Proceed using the context provided above.".to_string()
                } else {
                    extra.to_string()
                }
            }
            Intent::Plan => format!("{base}{extra}"),
            _ if extra.is_empty() => base.to_string(),
            _ => format!("{base}\n\nAdditional instructions from the user:\n{extra}"),
        }
    }
}

/// A human-approval gate.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateConfig {
    #[serde(default)]
    pub prompt: Option<String>,
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
    /// A gate awaiting human approval.
    Paused,
    /// The agent asked a question and is waiting for the user's reply.
    AwaitingInput,
}

impl NodeRunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            NodeRunStatus::Pending => "pending",
            NodeRunStatus::Running => "running",
            NodeRunStatus::Done => "done",
            NodeRunStatus::Failed => "failed",
            NodeRunStatus::Skipped => "skipped",
            NodeRunStatus::Paused => "paused",
            NodeRunStatus::AwaitingInput => "awaitingInput",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "pending" => NodeRunStatus::Pending,
            "running" => NodeRunStatus::Running,
            "done" => NodeRunStatus::Done,
            "failed" => NodeRunStatus::Failed,
            "skipped" => NodeRunStatus::Skipped,
            "paused" => NodeRunStatus::Paused,
            "awaitingInput" => NodeRunStatus::AwaitingInput,
            _ => return None,
        })
    }
}
