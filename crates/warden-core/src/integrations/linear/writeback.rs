//! Best-effort writeback to Linear: state transitions on session start/merge
//! and PR attachments on open. Everything here degrades to a warn log — a
//! Linear hiccup must never block session or PR flows.

use crate::error::Result;
use crate::store::Store;

use super::client::{self, LinearWorkflowState};
use super::{key, sync};

/// The team's primary state of `state_type` ("started"/"completed"): lowest
/// `position` wins when a team has several (e.g. In Progress + In Review).
async fn resolve_state(
    key: &str,
    team_id: &str,
    state_type: &str,
) -> Result<Option<LinearWorkflowState>> {
    let states = client::fetch_team_states(key, team_id).await?;
    Ok(states
        .into_iter()
        .filter(|s| s.state_type == state_type)
        .min_by(|a, b| a.position.total_cmp(&b.position)))
}

/// Move an issue to its team's primary state of `state_type` (e.g. "started",
/// "completed", "unstarted"), resolving the team live. The fallible variant for
/// callers — the MCP server — that surface failures back to the agent rather
/// than swallowing them like [`start_issue`]/[`complete_issue`].
pub async fn transition_issue(key: &str, issue_id: &str, state_type: &str) -> Result<()> {
    let team_id = client::fetch_issue_team_id(key, issue_id).await?;
    match resolve_state(key, &team_id, state_type).await? {
        Some(state) => client::update_issue_state(key, issue_id, &state.id).await,
        None => Err(crate::error::AppError::Integration(format!(
            "team has no {state_type} state"
        ))),
    }
}

/// Move an issue to its team's primary "started" state.
pub async fn start_issue(key: &str, issue_id: &str, team_id: &str) -> Result<()> {
    match resolve_state(key, team_id, "started").await? {
        Some(state) => client::update_issue_state(key, issue_id, &state.id).await,
        None => {
            log::warn!("linear: team {team_id} has no started state; skipping transition");
            Ok(())
        }
    }
}

/// Attach a PR link to the issue. Infallible by design (logs on failure).
pub async fn attach_pr(issue_id: &str, pr_url: &str) {
    let Ok(Some(key)) = key::load() else { return };
    if let Err(e) = client::attach_github_url(&key, issue_id, pr_url).await {
        log::warn!("linear: PR attach failed for {issue_id}: {e}");
    }
}

/// Move the issue to its team's primary "completed" state. Infallible by
/// design (logs on failure). Resolves the team live — the cached issue row
/// may be gone by merge time.
async fn complete_issue(key: &str, issue_id: &str) {
    let result: Result<()> = async {
        let team_id = client::fetch_issue_team_id(key, issue_id).await?;
        match resolve_state(key, &team_id, "completed").await? {
            Some(state) => client::update_issue_state(key, issue_id, &state.id).await,
            None => Ok(()),
        }
    }
    .await;
    if let Err(e) = result {
        log::warn!("linear: complete transition failed for {issue_id}: {e}");
    }
}

/// The full merge-time writeback: complete the issue in Linear and reconcile the
/// local cache, so callers (the GitHub merge poll) hit one entry point instead of
/// reaching into `key`, `client`, and `sync`. Best-effort throughout — a missing
/// key or a Linear hiccup is a no-op. Returns whether the cached issue set
/// changed, so the caller can decide whether to emit a change event.
pub async fn on_pr_merged(store: &Store, issue_id: &str) -> bool {
    let Ok(Some(key)) = key::load() else {
        return false; // not connected — nothing to write back
    };
    complete_issue(&key, issue_id).await;
    matches!(sync::sync_once(store, &key).await, Ok(true))
}
