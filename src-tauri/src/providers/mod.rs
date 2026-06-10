//! The agent CLI providers that back chat sessions. Each provider owns its turn
//! adapter, CLI distribution, and auth in its own folder; the managed-binary
//! machinery they share lives in [`crate::cli`].

pub mod claude;
pub mod codex;
pub mod context;
pub mod jsonrpc;

use std::time::Duration;

use crate::cli::{self, Tool, ToolStatus};
use crate::error::Result;

/// How long to wait on the network "latest version" check before giving up so a
/// status refresh never hangs the provider panel.
const LATEST_VERSION_TIMEOUT: Duration = Duration::from_secs(8);

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

/// Probe every provider: resolve the effective binary and read versions/auth on
/// a worker thread, then fold in the latest published version (best-effort).
pub async fn status_all() -> Result<Vec<ToolStatus>> {
    let mut statuses: Vec<ToolStatus> = tauri::async_runtime::spawn_blocking(|| {
        Provider::ALL
            .iter()
            .map(|&provider| {
                let mut status = cli::base_status(provider.tool());
                status.authed = match provider {
                    Provider::Claude => claude::auth::is_authed(),
                    Provider::Codex => codex::auth::is_authed(status.path.as_deref()),
                };
                status
            })
            .collect()
    })
    .await
    .map_err(|e| crate::error::AppError::Agent(format!("provider probe failed: {e}")))?;

    for (provider, status) in Provider::ALL.iter().zip(statuses.iter_mut()) {
        cli::fill_latest(status, provider.tool(), LATEST_VERSION_TIMEOUT).await;
    }
    Ok(statuses)
}

pub mod commands;
