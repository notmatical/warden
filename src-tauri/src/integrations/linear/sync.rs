//! Reconcile assigned Linear issues into the local cache. The inbox is "assigned
//! to me" (a small set), so each sync does a full replace — simpler and more
//! correct here than incremental (reassigned-away issues drop out cleanly).
//! Incremental `updatedAt` sync arrives with team-wide syncing.

use crate::error::Result;
use crate::store::{LinearIssueRow, Store};

use super::client::{self, LinearIssue};

/// The cached issues for the UI, newest-updated first.
pub fn cached_issues(store: &Store) -> Result<Vec<LinearIssue>> {
    Ok(store
        .linear_issue_payloads()?
        .iter()
        .filter_map(|p| serde_json::from_str(p).ok())
        .collect())
}

/// Fetch assigned issues and replace the cache. Returns whether the cached set
/// changed (by `id` + `updatedAt`), so callers can decide whether to emit a
/// change event.
pub async fn sync_once(store: &Store, key: &str) -> Result<bool> {
    let issues = client::fetch_assigned_issues(key).await?;

    let mut next: Vec<(String, String)> = issues
        .iter()
        .map(|i| (i.id.clone(), i.updated_at.clone()))
        .collect();
    next.sort();

    let mut current = store.linear_issue_versions()?;
    current.sort();
    if next == current {
        return Ok(false);
    }

    let rows = issues
        .iter()
        .map(|i| {
            Ok(LinearIssueRow {
                id: i.id.clone(),
                updated_at: i.updated_at.clone(),
                payload: serde_json::to_string(i)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    store.replace_linear_issues(&rows)?;
    Ok(true)
}
