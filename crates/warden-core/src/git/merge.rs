//! Folding a session's branch back into (or up to date with) its base:
//! merge/rebase modes, conflict detection, and the pull/sync entry points.

use std::path::Path;

use strum::{EnumString, IntoStaticStr};

use super::cli::{has_uncommitted_changes, run, run_raw};
use crate::error::{AppError, Result};

/// How a session's branch is folded back into its base branch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumString, IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum MergeMode {
    /// Collapse the branch's work into a single commit on the base.
    Squash,
    /// Preserve the branch's commits behind a merge commit. Serializes as
    /// `merge` (the UI token), not the variant name.
    #[strum(serialize = "merge")]
    MergeCommit,
    /// Rebase the branch onto the base, then fast-forward.
    Rebase,
}

impl MergeMode {
    pub fn as_str(self) -> &'static str {
        self.into()
    }

    pub fn parse(s: &str) -> Option<Self> {
        s.parse().ok()
    }
}

/// The result of folding a branch into its base.
pub enum MergeOutcome {
    Merged,
    /// The merge stopped on conflicts (and was aborted); these files clashed.
    Conflict(Vec<String>),
}

fn conflicted_files(cwd: &Path) -> Vec<String> {
    run(cwd, &["diff", "--name-only", "--diff-filter=U"])
        .map(|out| {
            out.lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// Rebase (or, for `MergeMode::MergeCommit`, merge) HEAD onto `target` (a ref
/// like `@{upstream}` or `origin/<base>`). Aborts cleanly on conflict, leaving
/// the branch untouched, and reports the clashing files. Squash has no meaning
/// here and is treated as rebase.
fn rebase_or_merge_onto(worktree: &Path, target: &str, mode: MergeMode) -> Result<MergeOutcome> {
    let (op, abort): (Vec<&str>, &[&str]) = match mode {
        MergeMode::MergeCommit => (vec!["merge", target], &["merge", "--abort"]),
        _ => (vec!["rebase", target], &["rebase", "--abort"]),
    };
    let out = run_raw(worktree, &op)?;
    if !out.status.success() {
        let files = conflicted_files(worktree);
        let _ = run_raw(worktree, abort);
        return Ok(MergeOutcome::Conflict(files));
    }
    Ok(MergeOutcome::Merged)
}

/// Pull the latest commits on the current branch from its upstream: fetch, then
/// merge (or rebase) `@{upstream}` into HEAD. Refuses on a dirty tree; aborts
/// cleanly on conflict, returning the clashing files.
pub fn pull_upstream(worktree: &Path, mode: MergeMode) -> Result<MergeOutcome> {
    if has_uncommitted_changes(worktree) {
        return Err(AppError::Git(
            "commit or discard the worktree's changes before pulling".to_string(),
        ));
    }
    // Fetch whatever the branch tracks; @{upstream} then points at the new tip.
    let _ = run_raw(worktree, &["fetch"]);
    rebase_or_merge_onto(worktree, "@{upstream}", mode)
}

/// Bring the worktree's branch up to date with `origin/<base>` by rebase (or
/// merge). Refuses on a dirty tree; aborts cleanly on conflict, leaving the
/// branch untouched.
pub fn sync_onto_base(worktree: &Path, base: &str, mode: MergeMode) -> Result<MergeOutcome> {
    if has_uncommitted_changes(worktree) {
        return Err(AppError::Git(
            "commit or discard the worktree's changes before syncing".to_string(),
        ));
    }
    rebase_or_merge_onto(worktree, &format!("origin/{base}"), mode)
}
