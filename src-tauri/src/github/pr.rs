//! Pull-request operations via the `gh` CLI, authenticated with the brokered
//! token so they work off the gh login warden manages.

use std::path::Path;
use std::process::Command;

use serde::Serialize;
use serde_json::Value;
use specta::Type;

use crate::cli::{self, Tool};
use crate::domain::CheckStatus;
use crate::error::{AppError, Result};
use crate::git::MergeMode;

/// A pull request's identity and state, as surfaced to the UI.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PrInfo {
    pub number: i64,
    pub url: String,
    /// GitHub's PR state: `OPEN`, `MERGED`, or `CLOSED`.
    pub state: String,
    pub title: String,
    /// Aggregate CI-check state, or `None` when the PR has no checks.
    pub check_status: Option<CheckStatus>,
}

/// An open PR in a repo, for the review-checkout picker.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PrSummary {
    pub number: i64,
    pub title: String,
    pub author: String,
    pub head_ref: String,
}

/// List open PRs in the repo (empty when there's no remote / not a gh repo).
pub fn list_prs(repo: &Path) -> Vec<PrSummary> {
    let Ok(out) = gh(
        repo,
        &[
            "pr",
            "list",
            "--state",
            "open",
            "--limit",
            "100",
            "--json",
            "number,title,author,headRefName",
        ],
    )
    .output() else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }
    serde_json::from_slice::<Value>(&out.stdout)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    Some(PrSummary {
                        number: item.get("number")?.as_i64()?,
                        title: item.get("title")?.as_str()?.to_string(),
                        author: item
                            .get("author")
                            .and_then(|a| a.get("login"))
                            .and_then(Value::as_str)
                            .unwrap_or("unknown")
                            .to_string(),
                        head_ref: item
                            .get("headRefName")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The base branch a PR targets (e.g. `main`), via `gh pr view`.
pub fn pr_base_ref(repo: &Path, number: i64) -> Option<String> {
    let out = gh(
        repo,
        &["pr", "view", &number.to_string(), "--json", "baseRefName"],
    )
    .output()
    .ok()?;
    if !out.status.success() {
        return None;
    }
    serde_json::from_slice::<Value>(&out.stdout)
        .ok()?
        .get("baseRefName")?
        .as_str()
        .map(str::to_string)
}

/// Distill `gh`'s `statusCheckRollup` array into one aggregate state: any failing
/// check ⇒ Failure, else any in-flight ⇒ Pending, else Success. Empty ⇒ None.
fn rollup_to_status(rollup: Option<&Value>) -> Option<CheckStatus> {
    let items = rollup?.as_array()?;
    if items.is_empty() {
        return None;
    }
    let mut any_pending = false;
    for item in items {
        // CheckRun carries `conclusion` (once done) then `status`; StatusContext
        // carries `state`. Prefer the most specific present.
        let raw = item
            .get("conclusion")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .or_else(|| item.get("state").and_then(Value::as_str))
            .or_else(|| item.get("status").and_then(Value::as_str))
            .unwrap_or("")
            .to_uppercase();
        match raw.as_str() {
            "FAILURE" | "ERROR" | "CANCELLED" | "TIMED_OUT" | "ACTION_REQUIRED"
            | "STARTUP_FAILURE" => return Some(CheckStatus::Failure),
            "SUCCESS" | "NEUTRAL" | "SKIPPED" | "" => {}
            _ => any_pending = true,
        }
    }
    Some(if any_pending {
        CheckStatus::Pending
    } else {
        CheckStatus::Success
    })
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
/// as structured data. `draft` opens it as a draft PR.
pub fn create_pr(
    worktree: &Path,
    base: &str,
    title: &str,
    body: &str,
    draft: bool,
) -> Result<PrInfo> {
    let mut args = vec![
        "pr", "create", "--base", base, "--title", title, "--body", body,
    ];
    if draft {
        args.push("--draft");
    }
    let out = gh(worktree, &args)
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

/// Merge the worktree branch's open PR via `gh pr merge`, by the chosen method.
/// `gh` itself refuses (non-zero) when the PR isn't mergeable (conflicts,
/// blocked, not open) — that error is surfaced verbatim.
pub fn merge(worktree: &Path, strategy: MergeMode) -> Result<()> {
    let method = match strategy {
        MergeMode::Squash => "--squash",
        MergeMode::MergeCommit => "--merge",
        MergeMode::Rebase => "--rebase",
    };
    let out = gh(worktree, &["pr", "merge", method])
        .output()
        .map_err(|e| AppError::Git(format!("failed to run gh: {e}")))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(AppError::Git(format!(
            "gh pr merge failed: {}",
            stderr.trim()
        )));
    }
    Ok(())
}

/// The PR associated with the worktree's current branch, or `None` when there
/// isn't one (gh exits non-zero in that case).
pub fn status(worktree: &Path) -> Result<Option<PrInfo>> {
    let out = gh(
        worktree,
        &[
            "pr",
            "view",
            "--json",
            "number,url,state,title,statusCheckRollup",
        ],
    )
    .output()
    .map_err(|e| AppError::Git(format!("failed to run gh: {e}")))?;

    if !out.status.success() {
        return Ok(None);
    }

    let value: Value = serde_json::from_slice(&out.stdout)
        .map_err(|e| AppError::Git(format!("could not parse gh output: {e}")))?;
    Ok(Some(PrInfo {
        number: value.get("number").and_then(Value::as_i64).unwrap_or(0),
        url: value
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        state: value
            .get("state")
            .and_then(Value::as_str)
            .unwrap_or("OPEN")
            .to_string(),
        title: value
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        check_status: rollup_to_status(value.get("statusCheckRollup")),
    }))
}
