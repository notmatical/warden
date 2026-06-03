use serde::{Deserialize, Serialize};

/// Which agent backend powers a session. Only Claude is implemented today, but
/// the enum is the seam where future providers (codex, cursor, ...) plug in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Backend {
    Claude,
}

impl Backend {
    pub fn as_str(self) -> &'static str {
        match self {
            Backend::Claude => "claude",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "claude" => Some(Backend::Claude),
            _ => None,
        }
    }
}

/// Permission posture handed to the agent CLI. Sessions are worktree-isolated,
/// so `BypassPermissions` is the default for autonomous, prompt-free turns.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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

/// Whether a session is a headless agent (stream-json adapter) or an
/// interactive terminal running the native `claude` TUI in a PTY.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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
    /// Absolute path the agent runs in (an isolated worktree, or the repo root).
    pub working_dir: String,
    pub branch: Option<String>,
    pub base_sha: Option<String>,
    pub is_isolated: bool,
    /// Tool patterns the user has approved for this session (`--allowedTools`),
    /// accumulated as denied tools are approved.
    pub allowed_tools: Vec<String>,
    pub turns: i64,
    pub cost_usd: f64,
    /// Set when this session was produced by a handoff from another session.
    pub parent_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
