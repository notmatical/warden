//! The agent-invocation vocabulary: what you hand a provider to run one turn.
//! Lives in core (not `session/`) so the provider layer depends only on the core
//! floor, never up on a feature module.

use serde::{Deserialize, Serialize};
use specta::Type;
use strum::{EnumString, IntoStaticStr, VariantArray};

/// Permission posture handed to the agent CLI. Sessions are worktree-isolated,
/// so `BypassPermissions` is the default for autonomous, prompt-free turns.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    Type,
    EnumString,
    IntoStaticStr,
    VariantArray,
)]
#[serde(rename_all = "camelCase")]
#[strum(serialize_all = "camelCase")]
pub enum PermissionMode {
    AcceptEdits,
    BypassPermissions,
    Plan,
    Default,
}

impl PermissionMode {
    /// The CLI token (`claude --permission-mode acceptEdits`) — identical to the
    /// serde and DB representation.
    pub fn as_str(self) -> &'static str {
        self.into()
    }

    pub fn parse(s: &str) -> Option<Self> {
        s.parse().ok()
    }
}

/// Reasoning effort for a session. `low..max` are `--effort` tokens; `Ultracode`
/// is a Claude Code session setting (xhigh effort + workflow orchestration) that
/// each adapter maps to what its CLI accepts — it is *not* itself an `--effort`
/// token.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    Type,
    EnumString,
    IntoStaticStr,
    VariantArray,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum EffortLevel {
    Low,
    Medium,
    High,
    Xhigh,
    Max,
    Ultracode,
}

impl EffortLevel {
    /// The canonical string (serde/DB). `Ultracode` is not a real `--effort`
    /// token — adapters special-case it.
    pub fn as_str(self) -> &'static str {
        self.into()
    }

    pub fn parse(s: &str) -> Option<Self> {
        s.parse().ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_mode_strings_agree() {
        for &m in PermissionMode::VARIANTS {
            assert_eq!(
                serde_json::to_value(m).unwrap(),
                serde_json::Value::String(m.as_str().to_owned()),
            );
            assert_eq!(PermissionMode::parse(m.as_str()), Some(m));
        }
    }

    #[test]
    fn effort_level_strings_agree() {
        for &e in EffortLevel::VARIANTS {
            assert_eq!(
                serde_json::to_value(e).unwrap(),
                serde_json::Value::String(e.as_str().to_owned()),
            );
            assert_eq!(EffortLevel::parse(e.as_str()), Some(e));
        }
    }
}
