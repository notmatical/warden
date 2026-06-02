//! Thin wrapper over the `git` CLI for isolating each session in its own
//! worktree. (Diffing lives in a future, focused iteration.)

use std::path::Path;
use std::process::Command;

use crate::error::{AppError, Result};

/// Run a git subcommand in `cwd`, returning stdout or a descriptive error.
fn run(cwd: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git").current_dir(cwd).args(args).output()?;
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

/// Whether `path` sits inside a git working tree.
pub fn is_repo(path: &Path) -> bool {
    Command::new("git")
        .current_dir(path)
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// The current HEAD commit SHA of a repository.
pub fn head_sha(repo: &Path) -> Result<String> {
    Ok(run(repo, &["rev-parse", "HEAD"])?.trim().to_string())
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
    run(repo, &["worktree", "remove", "--force", &dest])?;
    Ok(())
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
            for line in out.lines() {
                let mut cols = line.split('\t');
                // Binary files report `-` for both counts; skip those entries.
                if let (Some(a), Some(r)) = (cols.next(), cols.next()) {
                    added += a.trim().parse::<u32>().unwrap_or(0);
                    removed += r.trim().parse::<u32>().unwrap_or(0);
                }
            }
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
