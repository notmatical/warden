//! GitHub integration over the `gh` CLI: manage the CLI, broker the user's token
//! for authenticated calls, and read/write issues and pull requests. The managed
//! `gh` distribution lives in [`crate::dist::gh`]; this module is the runtime side.

pub mod issues;
pub mod pr;
// Lands with the engine tier: pr_content calls `agent::oneshot`, which isn't
// ported yet. Re-enable once `agent/oneshot.rs` exists in warden-core.
// pub mod pr_content;
mod token;

use std::path::Path;
use std::process::Command;
use std::time::Duration;

use serde_json::Value;

pub use token::resolve_token;

use crate::cli::{self, Tool, ToolStatus};
use crate::error::{AppError, Result};

/// A `gh` command rooted in `cwd`, configured for silent background use, with a
/// brokered token injected so it's authenticated regardless of the ambient shell
/// environment. Pass `token` to reuse a resolved one; `None` resolves it here.
pub(crate) fn gh_command(cwd: &Path, args: &[&str], token: Option<&str>) -> Command {
    let mut cmd = Command::new(cli::resolve(Tool::Gh));
    crate::platform::silent_command(&mut cmd);
    cmd.current_dir(cwd).args(args);
    match token {
        Some(token) => {
            cmd.env("GH_TOKEN", token);
        }
        None => {
            if let Some(token) = resolve_token() {
                cmd.env("GH_TOKEN", token);
            }
        }
    }
    cmd
}

/// Run a `gh ... --json ...` command in `cwd` and parse stdout as JSON.
///
/// Soft-fail (the command spawns but exits non-zero, e.g. no PR for the branch,
/// no remote, not a gh repo) returns `Ok(None)` so callers degrade gracefully.
/// Hard-fail (the binary can't be spawned, or stdout isn't valid JSON) returns
/// an [`AppError::Integration`].
pub(crate) fn gh_json(cwd: &Path, args: &[&str]) -> Result<Option<Value>> {
    let out = gh_command(cwd, args, None)
        .output()
        .map_err(|e| AppError::Integration(format!("failed to run gh: {e}")))?;
    if !out.status.success() {
        return Ok(None);
    }
    let value = serde_json::from_slice(&out.stdout)
        .map_err(|e| AppError::Integration(format!("could not parse gh output: {e}")))?;
    Ok(Some(value))
}

/// A non-empty string field, `None` when absent or empty.
pub(crate) fn str_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// An integer field, defaulting to `0` when absent.
pub(crate) fn i64_field(value: &Value, key: &str) -> i64 {
    value.get(key).and_then(Value::as_i64).unwrap_or(0)
}

/// A boolean field, defaulting to `false` when absent.
pub(crate) fn bool_field(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

/// The `login` of an `author`-shaped object, or `"unknown"`. Single source of
/// truth for the issue/PR author plucker.
pub(crate) fn author_login(value: Option<&Value>) -> String {
    value
        .and_then(|a| a.get("login"))
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string()
}

/// Status check timeout for the gh latest-version lookup.
const LATEST_TIMEOUT: Duration = Duration::from_secs(8);

/// Whether the resolved `gh` is logged in (`gh auth status` exits 0).
pub fn is_authed() -> bool {
    let gh = cli::resolve(Tool::Gh);
    crate::platform::silent_command(&mut Command::new(&gh))
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
