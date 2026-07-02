use serde::{Deserialize, Serialize};
use specta::Type;
use strum::{EnumString, IntoStaticStr, VariantArray};

use crate::{Backend, EffortLevel, PermissionMode};

/// Lifecycle state of a session.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    Type,
    EnumString,
    IntoStaticStr,
    VariantArray,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum SessionStatus {
    Idle,
    Running,
    Error,
}

impl SessionStatus {
    pub fn as_str(self) -> &'static str {
        self.into()
    }

    pub fn parse(s: &str) -> Option<Self> {
        s.parse().ok()
    }
}

/// Lifecycle of the worktree setup commands run for a session. Absent when the
/// repo configures none.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    Type,
    EnumString,
    IntoStaticStr,
    VariantArray,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum SetupStatus {
    Running,
    Failed,
    Done,
}

impl SetupStatus {
    pub fn as_str(self) -> &'static str {
        self.into()
    }

    pub fn parse(s: &str) -> Option<Self> {
        s.parse().ok()
    }
}

/// Aggregate CI-check state for a session's pull request, distilled from `gh`'s
/// `statusCheckRollup`. Absent when the PR has no checks.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    Type,
    EnumString,
    IntoStaticStr,
    VariantArray,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum CheckStatus {
    Success,
    Failure,
    Pending,
}

impl CheckStatus {
    pub fn as_str(self) -> &'static str {
        self.into()
    }

    pub fn parse(s: &str) -> Option<Self> {
        s.parse().ok()
    }
}

/// Per-state tallies of a PR's CI checks, persisted alongside the aggregate
/// rollup so list views can render counts without shelling out to `gh`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PrCheckCounts {
    pub passed: i64,
    pub failed: i64,
    pub pending: i64,
    pub skipped: i64,
}

/// Whether a session is a headless agent (stream-json adapter) or an
/// interactive terminal running the native `claude` TUI in a PTY.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    Type,
    EnumString,
    IntoStaticStr,
    VariantArray,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum SessionKind {
    Agent,
    Terminal,
}

impl SessionKind {
    pub fn as_str(self) -> &'static str {
        self.into()
    }

    pub fn parse(s: &str) -> Option<Self> {
        s.parse().ok()
    }
}

/// The role a session plays inside a recipe. Plain sessions are `Chat`; the
/// plan→code handoff produces a `Planner` and a `Coder`.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    Type,
    EnumString,
    IntoStaticStr,
    VariantArray,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum SessionRole {
    Chat,
    Planner,
    Coder,
}

impl SessionRole {
    pub fn as_str(self) -> &'static str {
        self.into()
    }

    pub fn parse(s: &str) -> Option<Self> {
        s.parse().ok()
    }
}

/// A single agent session — one tab in the browser. Carries everything needed
/// to resume the underlying CLI conversation and to render its state.
///
/// TODO(revise later): decompose the flat `pr_*` / `terminal_*` clusters into
/// nested `PrStatus` / `TerminalState` structs. Deferred — it reshapes the store
/// row mapping, `bindings.ts`, and the frontend. Tracked in docs/MONOREPO-MIGRATION.md.
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
    /// Worktree setup-commands lifecycle; `None` when none are configured.
    pub setup_status: Option<SetupStatus>,
    /// Tail of the failing setup output, when `setup_status` is `Failed`.
    pub setup_error: Option<String>,
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
    /// Linear issue this session was spawned from; drives writeback on PR
    /// open (attachment) and merge (completed state).
    pub linear_issue_id: Option<String>,
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
    pub pr_is_draft: bool,
    /// GitHub's review decision (`APPROVED`/`CHANGES_REQUESTED`/`REVIEW_REQUIRED`),
    /// absent when the repo requires no review.
    pub pr_review_decision: Option<String>,
    /// Per-state CI check tallies, `None` when the PR has no checks.
    pub pr_check_counts: Option<PrCheckCounts>,
    /// Pinned sessions sort to the top of the folder's session list.
    pub pinned: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    macro_rules! assert_roundtrip {
        ($ty:ty) => {
            for &v in <$ty>::VARIANTS {
                assert_eq!(
                    serde_json::to_value(v).unwrap(),
                    serde_json::Value::String(v.as_str().to_owned()),
                    "serde repr must match as_str for {v:?}",
                );
                assert_eq!(<$ty>::parse(v.as_str()), Some(v));
            }
        };
    }

    #[test]
    fn state_enum_strings_agree() {
        assert_roundtrip!(SessionStatus);
        assert_roundtrip!(SetupStatus);
        assert_roundtrip!(CheckStatus);
        assert_roundtrip!(SessionKind);
        assert_roundtrip!(SessionRole);
    }
}
