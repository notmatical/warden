//! Pull-request operations via the `gh` CLI, authenticated with the brokered
//! token so they work off the gh login warden manages.

use std::path::Path;
use std::str::FromStr;

use serde::Serialize;
use serde_json::Value;
use specta::Type;
use strum::{EnumString, IntoStaticStr, VariantArray};

use crate::error::{AppError, Result};
use crate::session::{CheckStatus, PrCheckCounts};

use super::{author_login, bool_field, gh_command, gh_json, i64_field, str_field};

/// GitHub's pull-request state. Parsed from gh's `state` (which is uppercase),
/// so the rest of the code branches on a variant instead of comparing strings.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Type, EnumString, IntoStaticStr, VariantArray,
)]
#[serde(rename_all = "UPPERCASE")]
#[strum(serialize_all = "UPPERCASE", ascii_case_insensitive)]
pub enum PrState {
    Open,
    Merged,
    Closed,
}

impl PrState {
    /// gh's uppercase token (`OPEN`/`MERGED`/`CLOSED`) — also the serde + store form.
    pub fn as_str(self) -> &'static str {
        self.into()
    }

    /// Parse gh's `state`, defaulting to `Open` when absent/unrecognized (gh only
    /// omits it on commands that don't request it).
    pub fn parse(s: &str) -> Self {
        Self::from_str(s).unwrap_or(PrState::Open)
    }

    pub fn is_merged(self) -> bool {
        matches!(self, PrState::Merged)
    }
}

/// A pull request's identity and state, as surfaced to the UI.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PrInfo {
    pub number: i64,
    pub url: String,
    pub state: PrState,
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
    pub state: PrState,
    pub title: String,
    pub is_draft: bool,
    /// `APPROVED`, `CHANGES_REQUESTED`, or `REVIEW_REQUIRED` (absent when the
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
    let Ok(Some(value)) = gh_json(
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
    ) else {
        return Vec::new();
    };
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    Some(PrSummary {
                        number: item.get("number")?.as_i64()?,
                        title: item.get("title")?.as_str()?.to_string(),
                        author: author_login(item.get("author")),
                        head_ref: str_field(item, "headRefName").unwrap_or_default(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The base branch a PR targets (e.g. `main`), via `gh pr view`.
pub fn pr_base_ref(repo: &Path, number: i64) -> Option<String> {
    let value = gh_json(
        repo,
        &["pr", "view", &number.to_string(), "--json", "baseRefName"],
    )
    .ok()??;
    str_field(&value, "baseRefName")
}

/// Classify one `statusCheckRollup` item — the single source of truth for what a
/// check's verdict means. CheckRuns carry `name`/`status`/`conclusion`;
/// StatusContexts carry `context`/`state`. Returns `None` for an item with no
/// name (not a real check row).
fn classify(item: &Value) -> Option<PrCheck> {
    let name = str_field(item, "name").or_else(|| str_field(item, "context"))?;
    let verdict = str_field(item, "conclusion")
        .or_else(|| str_field(item, "state"))
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
        url: str_field(item, "detailsUrl").or_else(|| str_field(item, "targetUrl")),
        started_at: str_field(item, "startedAt"),
        completed_at: str_field(item, "completedAt"),
    })
}

/// Parse a `statusCheckRollup` array into per-check rows.
fn checks_of(rollup: Option<&Value>) -> Vec<PrCheck> {
    rollup
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(classify).collect())
        .unwrap_or_default()
}

/// Distill the per-check rows into one aggregate state: any failing/cancelled
/// check ⇒ Failure, else any in-flight ⇒ Pending, else Success. Empty ⇒ None.
fn aggregate_status(checks: &[PrCheck]) -> Option<CheckStatus> {
    if checks.is_empty() {
        return None;
    }
    let mut any_pending = false;
    for check in checks {
        match check.state {
            PrCheckState::Failure | PrCheckState::Cancelled => return Some(CheckStatus::Failure),
            PrCheckState::Pending => any_pending = true,
            PrCheckState::Success | PrCheckState::Skipped => {}
        }
    }
    Some(if any_pending {
        CheckStatus::Pending
    } else {
        CheckStatus::Success
    })
}

/// Tally the per-check rows per state, folding cancelled into failed (matching
/// [`aggregate_status`]). Empty ⇒ None.
fn count_checks(checks: &[PrCheck]) -> Option<PrCheckCounts> {
    if checks.is_empty() {
        return None;
    }
    let mut counts = PrCheckCounts::default();
    for check in checks {
        match check.state {
            PrCheckState::Success => counts.passed += 1,
            PrCheckState::Failure | PrCheckState::Cancelled => counts.failed += 1,
            PrCheckState::Pending => counts.pending += 1,
            PrCheckState::Skipped => counts.skipped += 1,
        }
    }
    Some(counts)
}

/// Rich state of PR `number`, for the hover card. `None` when gh can't see it.
pub fn details(repo: &Path, number: i64) -> Result<Option<PrDetails>> {
    let Some(value) = gh_json(
        repo,
        &[
            "pr",
            "view",
            &number.to_string(),
            "--json",
            "number,url,state,title,isDraft,reviewDecision,additions,deletions,updatedAt,statusCheckRollup",
        ],
    )?
    else {
        return Ok(None);
    };
    Ok(Some(PrDetails {
        number: i64_field(&value, "number"),
        url: str_field(&value, "url").unwrap_or_default(),
        state: PrState::parse(&str_field(&value, "state").unwrap_or_default()),
        title: str_field(&value, "title").unwrap_or_default(),
        is_draft: bool_field(&value, "isDraft"),
        review_decision: str_field(&value, "reviewDecision"),
        additions: i64_field(&value, "additions"),
        deletions: i64_field(&value, "deletions"),
        updated_at: str_field(&value, "updatedAt"),
        checks: checks_of(value.get("statusCheckRollup")),
    }))
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
    let out = gh_command(worktree, &args, None)
        .output()
        .map_err(|e| AppError::Integration(format!("failed to run gh: {e}")))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(AppError::Integration(format!(
            "gh pr create failed: {}",
            stderr.trim()
        )));
    }

    status(worktree)?
        .ok_or_else(|| AppError::Integration("PR created but could not be read back".to_string()))
}

/// The PR associated with the worktree's current branch, or `None` when there
/// isn't one (gh exits non-zero in that case).
pub fn status(worktree: &Path) -> Result<Option<PrInfo>> {
    let Some(value) = gh_json(
        worktree,
        &[
            "pr",
            "view",
            "--json",
            "number,url,state,title,isDraft,reviewDecision,statusCheckRollup",
        ],
    )?
    else {
        return Ok(None);
    };
    let checks = checks_of(value.get("statusCheckRollup"));
    Ok(Some(PrInfo {
        number: i64_field(&value, "number"),
        url: str_field(&value, "url").unwrap_or_default(),
        state: PrState::parse(&str_field(&value, "state").unwrap_or_default()),
        title: str_field(&value, "title").unwrap_or_default(),
        is_draft: bool_field(&value, "isDraft"),
        review_decision: str_field(&value, "reviewDecision"),
        check_status: aggregate_status(&checks),
        check_counts: count_checks(&checks),
    }))
}
