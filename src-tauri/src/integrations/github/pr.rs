//! Pull-request operations via the `gh` CLI, authenticated with the brokered
//! token so they work off the gh login warden manages.

use std::path::Path;

use serde::Serialize;
use serde_json::Value;
use specta::Type;

use crate::domain::{CheckStatus, PrCheckCounts};
use crate::error::{AppError, Result};

/// A pull request's identity and state, as surfaced to the UI.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PrInfo {
    pub number: i64,
    pub url: String,
    /// GitHub's PR state: `OPEN`, `MERGED`, or `CLOSED`.
    pub state: String,
    pub title: String,
    pub is_draft: bool,
    /// `APPROVED`, `CHANGES_REQUESTED`, or `REVIEW_REQUIRED` (absent when the
    /// repo requires no review).
    pub review_decision: Option<String>,
    /// Aggregate CI-check state, or `None` when the PR has no checks.
    pub check_status: Option<CheckStatus>,
    /// Per-state CI check tallies, `None` when the PR has no checks.
    pub check_counts: Option<PrCheckCounts>,
}

/// One CI check's outcome on a PR, for the hover card's per-check rows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PrCheckState {
    Success,
    Failure,
    Pending,
    Skipped,
    Cancelled,
}

/// One CI check (check run or commit status) on a PR's head commit.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PrCheck {
    pub name: String,
    pub state: PrCheckState,
    pub url: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

/// Richer PR state for the hover card: review decision, diff stats, and the
/// individual CI checks behind the aggregate glyph.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PrDetails {
    pub number: i64,
    pub url: String,
    /// GitHub's PR state: `OPEN`, `MERGED`, or `CLOSED`.
    pub state: String,
    pub title: String,
    pub is_draft: bool,
    /// `APPROVED`, `CHANGES_REQUESTED`, or `REVIEW_REQUIRED` (empty when the
    /// repo requires no review).
    pub review_decision: Option<String>,
    pub additions: i64,
    pub deletions: i64,
    pub updated_at: Option<String>,
    pub checks: Vec<PrCheck>,
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

/// Tally `statusCheckRollup` items per state, folding cancelled into failed
/// (matching `rollup_to_status`). Empty/absent ⇒ None.
fn rollup_counts(rollup: Option<&Value>) -> Option<PrCheckCounts> {
    let items = rollup?.as_array()?;
    if items.is_empty() {
        return None;
    }
    let mut counts = PrCheckCounts::default();
    for state in items.iter().filter_map(|i| check_row(i).map(|c| c.state)) {
        match state {
            PrCheckState::Success => counts.passed += 1,
            PrCheckState::Failure | PrCheckState::Cancelled => counts.failed += 1,
            PrCheckState::Pending => counts.pending += 1,
            PrCheckState::Skipped => counts.skipped += 1,
        }
    }
    Some(counts)
}

/// Map one `statusCheckRollup` item to a check row. CheckRuns carry
/// `name`/`status`/`conclusion`; StatusContexts carry `context`/`state`.
fn check_row(item: &Value) -> Option<PrCheck> {
    let text = |key: &str| {
        item.get(key)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    let name = text("name").or_else(|| text("context"))?;
    let verdict = text("conclusion")
        .or_else(|| text("state"))
        .unwrap_or_default()
        .to_uppercase();
    let completed = match item.get("status").and_then(Value::as_str) {
        Some(s) => s.eq_ignore_ascii_case("COMPLETED"),
        None => true, // StatusContexts have no `status`; their `state` is final
    };
    let state = match verdict.as_str() {
        _ if !completed => PrCheckState::Pending,
        "SUCCESS" | "NEUTRAL" => PrCheckState::Success,
        "SKIPPED" => PrCheckState::Skipped,
        "CANCELLED" => PrCheckState::Cancelled,
        "FAILURE" | "ERROR" | "TIMED_OUT" | "ACTION_REQUIRED" | "STARTUP_FAILURE" | "STALE" => {
            PrCheckState::Failure
        }
        _ => PrCheckState::Pending,
    };
    Some(PrCheck {
        name,
        state,
        url: text("detailsUrl").or_else(|| text("targetUrl")),
        started_at: text("startedAt"),
        completed_at: text("completedAt"),
    })
}

/// Rich state of PR `number`, for the hover card. `None` when gh can't see it.
pub fn details(repo: &Path, number: i64) -> Result<Option<PrDetails>> {
    let out = gh(
        repo,
        &[
            "pr",
            "view",
            &number.to_string(),
            "--json",
            "number,url,state,title,isDraft,reviewDecision,additions,deletions,updatedAt,statusCheckRollup",
        ],
    )
    .output()
    .map_err(|e| AppError::Git(format!("failed to run gh: {e}")))?;
    if !out.status.success() {
        return Ok(None);
    }

    let value: Value = serde_json::from_slice(&out.stdout)
        .map_err(|e| AppError::Git(format!("could not parse gh output: {e}")))?;
    let text = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    Ok(Some(PrDetails {
        number: value.get("number").and_then(Value::as_i64).unwrap_or(0),
        url: text("url").unwrap_or_default(),
        state: text("state").unwrap_or_else(|| "OPEN".to_string()),
        title: text("title").unwrap_or_default(),
        is_draft: value
            .get("isDraft")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        review_decision: text("reviewDecision"),
        additions: value.get("additions").and_then(Value::as_i64).unwrap_or(0),
        deletions: value.get("deletions").and_then(Value::as_i64).unwrap_or(0),
        updated_at: text("updatedAt"),
        checks: value
            .get("statusCheckRollup")
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(check_row).collect())
            .unwrap_or_default(),
    }))
}

use super::gh_command as gh;

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

/// The PR associated with the worktree's current branch, or `None` when there
/// isn't one (gh exits non-zero in that case).
pub fn status(worktree: &Path) -> Result<Option<PrInfo>> {
    let out = gh(
        worktree,
        &[
            "pr",
            "view",
            "--json",
            "number,url,state,title,isDraft,reviewDecision,statusCheckRollup",
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
        is_draft: value
            .get("isDraft")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        review_decision: value
            .get("reviewDecision")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        check_status: rollup_to_status(value.get("statusCheckRollup")),
        check_counts: rollup_counts(value.get("statusCheckRollup")),
    }))
}
