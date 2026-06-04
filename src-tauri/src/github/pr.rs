//! Pull-request operations via the `gh` CLI, authenticated with the brokered
//! token so they work off the gh login warden manages.

use std::path::Path;
use std::process::Command;

use serde::Serialize;

use crate::cli::{self, Tool};
use crate::error::{AppError, Result};

/// A pull request's identity and state, as surfaced to the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrInfo {
    pub number: i64,
    pub url: String,
    /// GitHub's PR state: `OPEN`, `MERGED`, or `CLOSED`.
    pub state: String,
    pub title: String,
}

/// A `gh` command rooted in `cwd`, with the brokered token injected so it's
/// authenticated regardless of the ambient shell environment.
fn gh(cwd: &Path, args: &[&str]) -> Command {
    let mut cmd = Command::new(cli::resolve(Tool::Gh));
    crate::platform::silent_command(&mut cmd);
    cmd.current_dir(cwd).args(args);
    if let Some(token) = super::resolve_token() {
        cmd.env("GH_TOKEN", token);
    }
    cmd
}

/// Open a PR for the worktree's current branch against `base`, then read it back
/// as structured data.
pub fn create_pr(worktree: &Path, base: &str, title: &str, body: &str) -> Result<PrInfo> {
    let out = gh(
        worktree,
        &[
            "pr", "create", "--base", base, "--title", title, "--body", body,
        ],
    )
    .output()
    .map_err(|e| AppError::Git(format!("failed to run gh: {e}")))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(AppError::Git(format!(
            "gh pr create failed: {}",
            stderr.trim()
        )));
    }

    status(worktree)?
        .ok_or_else(|| AppError::Git("PR created but could not be read back".to_string()))
}

/// The PR associated with the worktree's current branch, or `None` when there
/// isn't one (gh exits non-zero in that case).
pub fn status(worktree: &Path) -> Result<Option<PrInfo>> {
    let out = gh(
        worktree,
        &["pr", "view", "--json", "number,url,state,title"],
    )
    .output()
    .map_err(|e| AppError::Git(format!("failed to run gh: {e}")))?;

    if !out.status.success() {
        return Ok(None);
    }

    let value: serde_json::Value = serde_json::from_slice(&out.stdout)
        .map_err(|e| AppError::Git(format!("could not parse gh output: {e}")))?;
    Ok(Some(PrInfo {
        number: value.get("number").and_then(|v| v.as_i64()).unwrap_or(0),
        url: value
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        state: value
            .get("state")
            .and_then(|v| v.as_str())
            .unwrap_or("OPEN")
            .to_string(),
        title: value
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
    }))
}
