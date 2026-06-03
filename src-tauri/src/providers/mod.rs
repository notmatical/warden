//! Detection and status of the AI CLI providers that back sessions. A provider
//! is one of the supported agent CLIs; this module probes whether each is
//! installed, its version, and whether it is authenticated, so the UI can guide
//! the user through install/login before a session is created.

mod detect;

pub use detect::status_all;

use serde::{Deserialize, Serialize};

/// An agent CLI provider. Maps one-to-one onto [`crate::domain::Backend`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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

    /// The CLI binary resolved on PATH.
    pub fn bin(self) -> &'static str {
        match self {
            Provider::Claude => "claude",
            Provider::Codex => "codex",
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
pub struct ProviderStatus {
    pub id: String,
    pub name: String,
    pub installed: bool,
    pub version: Option<String>,
    pub authed: bool,
}
