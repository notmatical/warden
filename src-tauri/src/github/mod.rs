//! GitHub integration. Phase 0: manage the `gh` CLI and broker the user's token
//! for authenticated API calls. PR/issue operations build on this later.

pub mod download;
mod token;

use std::time::Duration;

pub use token::resolve_token;

use crate::cli::{self, Tool, ToolStatus};

/// Status check timeout for the gh latest-version lookup.
const LATEST_TIMEOUT: Duration = Duration::from_secs(8);

/// Whether the resolved `gh` is logged in (`gh auth status` exits 0).
fn is_authed() -> bool {
    let gh = cli::resolve(Tool::Gh);
    crate::platform::silent_command(&mut std::process::Command::new(&gh))
        .args(["auth", "status"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// The GitHub CLI's install/version/auth snapshot.
pub async fn status() -> ToolStatus {
    let mut status = cli::base_status(Tool::Gh);
    status.authed = is_authed();
    cli::fill_latest(&mut status, Tool::Gh, LATEST_TIMEOUT).await;
    status
}

pub mod commands;
