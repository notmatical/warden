//! GitHub integration. Phase 0: manage the `gh` CLI and broker the user's token
//! for authenticated API calls. PR/issue operations build on this later.

pub mod download;
pub mod issues;
pub mod poll;
pub mod pr;
pub mod pr_content;
mod token;

use std::path::Path;
use std::process::Command;
use std::time::Duration;

pub use token::resolve_token;

use crate::cli::{self, Tool, ToolStatus};

/// A `gh` command rooted in `cwd`, with the brokered token injected so it's
/// authenticated regardless of the ambient shell environment.
pub(crate) fn gh_command(cwd: &Path, args: &[&str]) -> Command {
    let mut cmd = Command::new(cli::resolve(Tool::Gh));
    crate::platform::silent_command(&mut cmd);
    cmd.current_dir(cwd).args(args);
    if let Some(token) = resolve_token() {
        cmd.env("GH_TOKEN", token);
    }
    cmd
}

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
