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
