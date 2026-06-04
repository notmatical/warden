//! The agent CLI providers that back chat sessions. A provider is a session
//! backend (one-to-one with [`crate::domain::Backend`]); the managed-binary
//! machinery it shares with other tools lives in [`crate::cli`].

mod detect;

pub use detect::status_all;

use crate::cli::Tool;

/// An agent CLI provider. Maps one-to-one onto [`crate::domain::Backend`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    Claude,
    Codex,
}

impl Provider {
    pub const ALL: [Provider; 2] = [Provider::Claude, Provider::Codex];

    /// The managed CLI tool this provider runs on.
    pub fn tool(self) -> Tool {
        match self {
            Provider::Claude => Tool::Claude,
            Provider::Codex => Tool::Codex,
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
