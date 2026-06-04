//! Detection and status of the AI CLI providers that back sessions. A provider
//! is one of the supported agent CLIs; this module probes whether each is
//! installed, its version, and whether it is authenticated, so the UI can guide
//! the user through install/login before a session is created.

mod detect;
pub mod install;
pub mod manage;

pub use detect::status_all;
pub use manage::{resolve, Source};

use serde::{Deserialize, Serialize};

/// An agent CLI provider. Maps one-to-one onto [`crate::domain::Backend`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    Claude,
    Codex,
}

impl Provider {
    pub const ALL: [Provider; 2] = [Provider::Claude, Provider::Codex];

    /// Stable id used on the IPC boundary and to look a provider up by string.
    pub fn id(self) -> &'static str {
        match self {
            Provider::Claude => "claude",
            Provider::Codex => "codex",
        }
    }

    /// Human-readable name for display.
    pub fn name(self) -> &'static str {
        match self {
            Provider::Claude => "Claude",
            Provider::Codex => "Codex",
        }
    }

    /// The CLI binary name resolved on PATH.
    pub fn bin(self) -> &'static str {
        match self {
            Provider::Claude => "claude",
            Provider::Codex => "codex",
        }
    }

    /// Subdirectory under the app data dir that holds the managed binary.
    pub fn cli_dir_name(self) -> &'static str {
        match self {
            Provider::Claude => "claude-cli",
            Provider::Codex => "codex-cli",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "claude" => Some(Provider::Claude),
            "codex" => Some(Provider::Codex),
            _ => None,
        }
    }
}

/// A provider's installation/auth snapshot, surfaced to the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub id: String,
    pub name: String,
    /// User's source preference: `auto` | `managed` | `system`.
    pub source: String,
    /// Whether the effective (resolved) binary is present and runnable.
    pub installed: bool,
    /// Version of the effective binary.
    pub version: Option<String>,
    /// Absolute path of the effective binary, when resolved.
    pub path: Option<String>,
    pub authed: bool,
    /// Whether a copy exists on the system PATH.
    pub system_detected: bool,
    /// Whether warden's managed copy is installed.
    pub managed_installed: bool,
    /// Version of the managed copy, if installed.
    pub managed_version: Option<String>,
    /// Latest published version (best-effort; `None` if the check failed).
    pub latest_version: Option<String>,
    /// Whether the managed copy is behind the latest published version.
    pub update_available: bool,
}
