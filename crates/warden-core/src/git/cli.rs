//! Thin wrapper over the `git` CLI: command builders, repo queries
//! (status/ahead-behind/branch), worktree lifecycle, and commit/push/fetch.
//! Structured diff/commit reading lives in `diff.rs`; merge/sync in `merge.rs`;
//! remote-URL normalization in `remote.rs`.

use std::path::Path;
use std::process::Command;

use crate::error::{AppError, Result};

/// Build a `git` command in `cwd`, configured for silent background use.
fn git(cwd: &Path, args: &[&str]) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(cwd).args(args);
    crate::platform::silent_command(&mut cmd);
    cmd
}

/// Run a git subcommand in `cwd`, returning stdout or a descriptive error.
pub(crate) fn run(cwd: &Path, args: &[&str]) -> Result<String> {
    let output = git(cwd, args).output()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!(
            "`git {}` failed: {}",
            args.join(" "),
            stderr.trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Run a git subcommand, returning its raw output without erroring on a non-zero
/// exit — callers inspect the status themselves (e.g. to detect merge conflicts).
pub(crate) fn run_raw(cwd: &Path, args: &[&str]) -> Result<std::process::Output> {
    Ok(git(cwd, args).output()?)
}

/// Whether `path` sits inside a git working tree.
pub fn is_repo(path: &Path) -> bool {
    git(path, &["rev-parse", "--is-inside-work-tree"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// The current HEAD commit SHA of a repository.
pub fn head_sha(repo: &Path) -> Result<String> {
    Ok(run(repo, &["rev-parse", "HEAD"])?.trim().to_string())
}

/// Whether a local branch with this name already exists.
pub fn branch_exists(repo: &Path, branch: &str) -> bool {
    run(
        repo,
        &["rev-parse", "--verify", &format!("refs/heads/{branch}")],
    )
    .is_ok()
}

/// Create a new worktree at `dest` on a fresh `branch` rooted at `base`.
pub fn create_worktree(repo: &Path, dest: &Path, branch: &str, base: &str) -> Result<()> {
    // Drop stale registrations (worktree folders removed outside warden) so a
    // fresh `add` can't fail on a leftover entry.
    let _ = run(repo, &["worktree", "prune"]);
    let dest = dest.to_string_lossy();
    run(repo, &["worktree", "add", "-b", branch, &dest, base])?;
    Ok(())
}

/// Remove a worktree. Used on session deletion; callers treat failures as
/// best-effort since orphaned worktrees are recoverable via `prune`.
pub fn remove_worktree(repo: &Path, dest: &Path) -> Result<()> {
    let dest = dest.to_string_lossy();
    // Windows briefly locks just-used files (antivirus, the search indexer, a
    // lingering child process), so `worktree remove` can hit a transient
    // "permission denied". Retry with a short backoff before giving up.
    let mut last: Result<()> = Ok(());
    for attempt in 0..4u64 {
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_millis(200 * attempt));
        }
        last = run(repo, &["worktree", "remove", "--force", &dest]).map(|_| ());
        if last.is_ok() {
            return Ok(());
        }
    }
    last
}

/// The current branch name of a working tree, or `None` on a detached HEAD.
pub fn current_branch(cwd: &Path) -> Option<String> {
    if let Ok(out) = run(cwd, &["symbolic-ref", "--short", "HEAD"]) {
        let name = out.trim();
        if !name.is_empty() {
            return Some(name.to_string());
        }
    }
    let out = run(cwd, &["rev-parse", "--abbrev-ref", "HEAD"]).ok()?;
    let name = out.trim();
    if name.is_empty() || name == "HEAD" {
        None
    } else {
        Some(name.to_string())
    }
}

/// Total added/removed lines across the working tree and the index, summed from
/// `diff --numstat` plus `diff --cached --numstat`.
pub fn uncommitted_lines(cwd: &Path) -> (u32, u32) {
    let mut added = 0u32;
    let mut removed = 0u32;
    let diff_sets: [&[&str]; 2] = [&["diff", "--numstat"], &["diff", "--cached", "--numstat"]];
    for args in diff_sets {
        if let Ok(out) = run(cwd, args) {
            let (a, r) = super::diff::parse_numstat(&out);
            added += a;
            removed += r;
        }
    }
    (added, removed)
}

/// Commits ahead/behind the configured upstream. `(0, 0)` when there is no
/// upstream — never an error, so a fresh branch reads as in sync.
pub fn ahead_behind(cwd: &Path) -> (u32, u32) {
    let out = match run(
        cwd,
        &["rev-list", "--count", "--left-right", "@{upstream}...HEAD"],
    ) {
        Ok(out) => out,
        Err(_) => return (0, 0),
    };
    let mut cols = out.split_whitespace();
    let behind = cols.next().and_then(|c| c.parse().ok()).unwrap_or(0);
    let ahead = cols.next().and_then(|c| c.parse().ok()).unwrap_or(0);
    (ahead, behind)
}

/// Whether the working tree (or index) has changes not yet committed.
pub fn has_uncommitted_changes(cwd: &Path) -> bool {
    run(cwd, &["status", "--porcelain"])
        .map(|o| !o.trim().is_empty())
        .unwrap_or(false)
}

/// How many files carry uncommitted changes (untracked included).
pub fn dirty_file_count(cwd: &Path) -> u32 {
    run(cwd, &["status", "--porcelain"])
        .map(|o| o.lines().filter(|l| !l.trim().is_empty()).count() as u32)
        .unwrap_or(0)
}

/// Commits on HEAD that `base` doesn't have — work lost if the branch goes.
pub fn unmerged_commit_count(cwd: &Path, base: &str) -> u32 {
    run(cwd, &["rev-list", "--count", &format!("{base}..HEAD")])
        .ok()
        .and_then(|o| o.trim().parse().ok())
        .unwrap_or(0)
}

/// Stage everything and commit in `worktree`. Returns whether a commit was made
/// (`false` when there was nothing to commit).
pub fn stage_and_commit(worktree: &Path, message: &str) -> Result<bool> {
    run(worktree, &["add", "-A"])?;
    let out = run_raw(worktree, &["commit", "-m", message])?;
    if out.status.success() {
        return Ok(true);
    }
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    if combined.contains("nothing to commit") {
        Ok(false)
    } else {
        Err(AppError::Git(format!(
            "git commit failed: {}",
            combined.trim()
        )))
    }
}

/// Delete a local branch (`-D`, force). Used after a session is merged.
pub fn delete_branch(repo: &Path, branch: &str) -> Result<()> {
    run(repo, &["branch", "-D", branch])?;
    Ok(())
}

/// The full textual diff of a worktree against `base` (a sha or branch) —
/// working-tree changes included — for handing to a review agent.
pub fn worktree_diff_text(worktree: &Path, base: &str) -> String {
    run(worktree, &["diff", base]).unwrap_or_default()
}

/// Whether the repo has at least one configured remote (a prerequisite for a PR).
pub fn has_remote(repo: &Path) -> bool {
    run(repo, &["remote"])
        .map(|o| !o.trim().is_empty())
        .unwrap_or(false)
}

/// Push the worktree's current branch to origin, setting upstream. Surfaces the
/// remote's own error (auth, missing remote) on failure.
pub fn push_branch(worktree: &Path) -> Result<()> {
    let out = run_raw(worktree, &["push", "-u", "origin", "HEAD"])?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(AppError::Git(format!("git push failed: {}", stderr.trim())));
    }
    Ok(())
}

/// Fetch the latest `base` branch from origin (best-effort; ignores failure when
/// there's no remote).
pub fn fetch_origin(worktree: &Path, base: &str) {
    let _ = run_raw(worktree, &["fetch", "origin", base]);
}
