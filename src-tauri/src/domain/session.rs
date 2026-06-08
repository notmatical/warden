use serde::{Deserialize, Serialize};
use specta::Type;

/// Which agent backend powers a session. Only Claude is implemented today, but
/// the enum is the seam where future providers (codex, cursor, ...) plug in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Backend {
    Claude,
    Codex,
}

impl Backend {
    pub fn as_str(self) -> &'static str {
        match self {
            Backend::Claude => "claude",
            Backend::Codex => "codex",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "claude" => Some(Backend::Claude),
            "codex" => Some(Backend::Codex),
            _ => None,
        }
    }

    /// The backend that runs a given model id: Codex for `gpt*`/`codex*`,
    /// Claude otherwise.
    pub fn for_model(model: &str) -> Self {
        let id = model.to_ascii_lowercase();
        if id.starts_with("gpt") || id.starts_with("codex") {
            Backend::Codex
        } else {
            Backend::Claude
        }
    }
}

/// Permission posture handed to the agent CLI. Sessions are worktree-isolated,
/// so `BypassPermissions` is the default for autonomous, prompt-free turns.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum PermissionMode {
    AcceptEdits,
    BypassPermissions,
    Plan,
    Default,
}

impl PermissionMode {
    /// The exact token expected by `claude --permission-mode`.
    pub fn as_cli(self) -> &'static str {
        match self {
            PermissionMode::AcceptEdits => "acceptEdits",
            PermissionMode::BypassPermissions => "bypassPermissions",
            PermissionMode::Plan => "plan",
            PermissionMode::Default => "default",
        }
    }

    pub fn as_str(self) -> &'static str {
        self.as_cli()
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "acceptEdits" => Some(PermissionMode::AcceptEdits),
            "bypassPermissions" => Some(PermissionMode::BypassPermissions),
            "plan" => Some(PermissionMode::Plan),
            "default" => Some(PermissionMode::Default),
            _ => None,
        }
    }
}

/// Reasoning effort handed to the agent CLI (`claude --effort`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum EffortLevel {
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

impl EffortLevel {
    /// The exact token expected by `claude --effort`.
    pub fn as_cli(self) -> &'static str {
        match self {
            EffortLevel::Low => "low",
            EffortLevel::Medium => "medium",
            EffortLevel::High => "high",
            EffortLevel::Xhigh => "xhigh",
            EffortLevel::Max => "max",
        }
    }

    pub fn as_str(self) -> &'static str {
        self.as_cli()
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "low" => Some(EffortLevel::Low),
            "medium" => Some(EffortLevel::Medium),
            "high" => Some(EffortLevel::High),
            "xhigh" => Some(EffortLevel::Xhigh),
            "max" => Some(EffortLevel::Max),
            _ => None,
        }
    }
}

/// Lifecycle state of a session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Idle,
    Running,
    Error,
}

impl SessionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            SessionStatus::Idle => "idle",
            SessionStatus::Running => "running",
            SessionStatus::Error => "error",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "idle" => Some(SessionStatus::Idle),
            "running" => Some(SessionStatus::Running),
            "error" => Some(SessionStatus::Error),
            _ => None,
        }
    }
}

/// Aggregate CI-check state for a session's pull request, distilled from `gh`'s
/// `statusCheckRollup`. Absent when the PR has no checks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CheckStatus {
    Success,
    Failure,
    Pending,
}

impl CheckStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            CheckStatus::Success => "success",
            CheckStatus::Failure => "failure",
            CheckStatus::Pending => "pending",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "success" => Some(CheckStatus::Success),
            "failure" => Some(CheckStatus::Failure),
            "pending" => Some(CheckStatus::Pending),
            _ => None,
        }
    }
}

/// Whether a session is a headless agent (stream-json adapter) or an
/// interactive terminal running the native `claude` TUI in a PTY.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SessionKind {
    Agent,
    Terminal,
}

impl SessionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            SessionKind::Agent => "agent",
            SessionKind::Terminal => "terminal",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "agent" => Some(SessionKind::Agent),
            "terminal" => Some(SessionKind::Terminal),
            _ => None,
        }
    }
}

/// The role a session plays inside a recipe. Plain sessions are `Chat`; the
/// plan→code handoff produces a `Planner` and a `Coder`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SessionRole {
    Chat,
    Planner,
    Coder,
}

impl SessionRole {
    pub fn as_str(self) -> &'static str {
        match self {
            SessionRole::Chat => "chat",
            SessionRole::Planner => "planner",
            SessionRole::Coder => "coder",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "chat" => Some(SessionRole::Chat),
            "planner" => Some(SessionRole::Planner),
            "coder" => Some(SessionRole::Coder),
            _ => None,
        }
    }
}

/// A single agent session — one tab in the browser. Carries everything needed
/// to resume the underlying CLI conversation and to render its state.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub group_id: String,
    /// The session's primary repo — where its agent runs. Additional roots are
    /// tracked in `session_roots` and handed to the CLI as extra directories.
    pub project_id: String,
    pub title: String,
    pub kind: SessionKind,
    pub backend: Backend,
    pub model: String,
    pub permission_mode: PermissionMode,
    pub effort: EffortLevel,
    pub status: SessionStatus,
    pub role: SessionRole,
    /// True while the title is still auto-assigned, so background naming may
    /// replace it. Set false once the user renames or auto-naming completes.
    pub auto_named: bool,
    /// The CLI conversation id we own (passed as `--session-id`, then `--resume`).
    pub agent_session_id: String,
    /// For a native CLI terminal, the provider program to launch (`claude`/`codex`)
    /// instead of the shell. `None` for plain shell terminals and agent sessions.
    pub terminal_command: Option<String>,
    /// Whether this terminal's CLI has been launched at least once — drives the
    /// switch from "start a new conversation" to "resume the existing one".
    pub terminal_started: bool,
    /// The provider's own conversation id, recovered after first launch so the
    /// terminal resumes that exact session. Used for Codex, which assigns its id
    /// (Claude pins `agent_session_id` up front and resumes by that instead).
    pub terminal_resume_id: Option<String>,
    /// Absolute path the agent runs in (an isolated worktree, or the repo root).
    pub working_dir: String,
    pub branch: Option<String>,
    pub base_sha: Option<String>,
    /// The repo branch an isolated session merges back into.
    pub base_branch: Option<String>,
    pub is_isolated: bool,
    /// Tool patterns the user has approved for this session (`--allowedTools`),
    /// accumulated as denied tools are approved.
    pub allowed_tools: Vec<String>,
    pub turns: i64,
    pub cost_usd: f64,
    /// Set when this session was produced by a handoff from another session.
    pub parent_id: Option<String>,
    /// Set when a workflow run spawned this session (groups it under the
    /// workflow in the sidebar).
    pub workflow_id: Option<String>,
    /// When the session's branch was merged back into its base — `None` until
    /// then. A merged session's worktree is gone, so it becomes read-only.
    pub merged_at: Option<String>,
    /// The open pull request for this session's branch, once one is created.
    pub pr_number: Option<i64>,
    pub pr_url: Option<String>,
    /// GitHub's PR state (`OPEN`/`MERGED`/`CLOSED`), refreshed by polling.
    pub pr_state: Option<String>,
    /// Aggregate CI-check state for the PR, and when it was last polled (epoch s).
    pub pr_check_status: Option<CheckStatus>,
    pub pr_checked_at: Option<i64>,
    /// Pinned sessions sort to the top of the folder's session list.
    pub pinned: bool,
    pub created_at: String,
    pub updated_at: String,
}
