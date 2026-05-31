//! Thin wrapper over the `git` CLI for the two things warden needs: isolating
//! each session in its own worktree, and diffing that worktree against the
//! commit it branched from.

use std::path::Path;
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};

/// Hard cap on the unified diff we ship to the frontend, so a runaway change set
/// can't blow up the IPC payload or the renderer.
const MAX_DIFF_BYTES: usize = 200_000;

/// A single file's change summary within a diff.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub additions: u32,
    pub deletions: u32,
    pub binary: bool,
}

/// The diff of a session's working directory against its base commit.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffResult {
    pub base_sha: Option<String>,
    pub unified: String,
    pub files: Vec<FileChange>,
    pub truncated: bool,
}

impl DiffResult {
    fn empty() -> Self {
        Self {
            base_sha: None,
            unified: String::new(),
            files: Vec::new(),
            truncated: false,
        }
    }
}

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
    let dest = dest.to_string_lossy();
    run(repo, &["worktree", "add", "-b", branch, &dest, base])?;
    Ok(())
}

/// Remove a worktree. Best-effort: a failure here is logged by the caller, not
/// propagated, since orphaned worktrees are recoverable but shouldn't block UX.
/// Part of the git API surface; retained for session teardown.
#[allow(dead_code)]
pub fn remove_worktree(repo: &Path, dest: &Path) -> Result<()> {
    let dest = dest.to_string_lossy();
    run(repo, &["worktree", "remove", "--force", &dest])?;
    Ok(())
}

/// Diff a session's working directory against its base commit. Untracked files
/// are surfaced via intent-to-add so new files appear in the diff. Returns an
/// empty result for non-isolated sessions (no base), which run in the user's own
/// checkout and must not have their index touched.
pub fn compute_diff(working_dir: &Path, base: Option<&str>) -> Result<DiffResult> {
    let Some(base) = base else {
        return Ok(DiffResult::empty());
    };

    // Mark untracked content as intent-to-add so it shows up in the diff without
    // staging file contents. Safe inside an isolated worktree.
    let _ = run(working_dir, &["add", "-A", "-N"]);

    let mut unified = run(working_dir, &["--no-pager", "diff", base])?;
    let numstat = run(working_dir, &["--no-pager", "diff", "--numstat", base])?;
    let files = parse_numstat(&numstat);

    let truncated = unified.len() > MAX_DIFF_BYTES;
    if truncated {
        unified.truncate(MAX_DIFF_BYTES);
    }

    Ok(DiffResult {
        base_sha: Some(base.to_string()),
        unified,
        files,
        truncated,
    })
}

/// Parse `git diff --numstat` output. Binary files report `-` for counts.
fn parse_numstat(numstat: &str) -> Vec<FileChange> {
    numstat
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\t');
            let add = parts.next()?;
            let del = parts.next()?;
            let path = parts.next()?;
            let binary = add == "-" || del == "-";
            Some(FileChange {
                path: path.to_string(),
                additions: add.parse().unwrap_or(0),
                deletions: del.parse().unwrap_or(0),
                binary,
            })
        })
        .collect()
}
