//! Thin wrapper over the `git` CLI: worktree lifecycle, status, integrate-back
//! (merge/rebase), PR fetch, and sync. Diff/commit reading lives in `diff.rs`.

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

// ----- integrate-back -------------------------------------------------------

/// How a session's branch is folded back into its base branch.
#[derive(Debug, Clone, Copy)]
pub enum MergeMode {
    /// Collapse the branch's work into a single commit on the base.
    Squash,
    /// Preserve the branch's commits behind a merge commit.
    MergeCommit,
    /// Rebase the branch onto the base, then fast-forward.
    Rebase,
}

impl MergeMode {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "squash" => Some(MergeMode::Squash),
            "merge" => Some(MergeMode::MergeCommit),
            "rebase" => Some(MergeMode::Rebase),
            _ => None,
        }
    }
}

/// The result of folding a branch into its base.
pub enum MergeOutcome {
    Merged,
    /// The merge stopped on conflicts (and was aborted); these files clashed.
    Conflict(Vec<String>),
}

/// Run a git subcommand, returning its raw output without erroring on a non-zero
/// exit — callers inspect the status themselves (e.g. to detect merge conflicts).
fn run_raw(cwd: &Path, args: &[&str]) -> Result<std::process::Output> {
    Ok(git(cwd, args).output()?)
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

/// Whether `feature` has commits the `base` branch does not — i.e. anything to
/// integrate.
pub fn has_changes_to_integrate(repo: &Path, feature: &str, base: &str) -> bool {
    run(
        repo,
        &["rev-list", "--count", &format!("{base}..{feature}")],
    )
    .ok()
    .and_then(|o| o.trim().parse::<u32>().ok())
    .map(|n| n > 0)
    .unwrap_or(false)
}

/// Fold `feature` into `base` (checked out in the main `repo`), per `mode`.
/// Refuses when the base checkout is dirty; aborts cleanly on conflict, leaving
/// the repo in its prior state.
pub fn merge_into_base(
    repo: &Path,
    worktree: &Path,
    feature: &str,
    base: &str,
    mode: MergeMode,
    message: &str,
) -> Result<MergeOutcome> {
    if has_uncommitted_changes(repo) {
        return Err(AppError::Git(
            "the base branch has uncommitted changes; commit or stash them first".to_string(),
        ));
    }
    run(repo, &["checkout", base])?;

    match mode {
        MergeMode::Squash => {
            let out = run_raw(repo, &["merge", "--squash", feature])?;
            if !out.status.success() {
                let files = conflicted_files(repo);
                let _ = run_raw(repo, &["reset", "--hard", "HEAD"]);
                return Ok(MergeOutcome::Conflict(files));
            }
            let commit = run_raw(repo, &["commit", "-m", message])?;
            if !commit.status.success() {
                let stderr = String::from_utf8_lossy(&commit.stderr);
                let _ = run_raw(repo, &["reset", "--hard", "HEAD"]);
                return Err(AppError::Git(format!("commit failed: {}", stderr.trim())));
            }
            Ok(MergeOutcome::Merged)
        }
        MergeMode::MergeCommit => {
            let out = run_raw(repo, &["merge", "--no-ff", feature, "-m", message])?;
            if !out.status.success() {
                let files = conflicted_files(repo);
                let _ = run_raw(repo, &["merge", "--abort"]);
                return Ok(MergeOutcome::Conflict(files));
            }
            Ok(MergeOutcome::Merged)
        }
        MergeMode::Rebase => {
            // Rebase the feature onto base in its own worktree, then fast-forward
            // the base branch in the main repo onto the now-linear feature.
            let out = run_raw(worktree, &["rebase", base])?;
            if !out.status.success() {
                let files = conflicted_files(worktree);
                let _ = run_raw(worktree, &["rebase", "--abort"]);
                return Ok(MergeOutcome::Conflict(files));
            }
            let ff = run_raw(repo, &["merge", "--ff-only", feature])?;
            if !ff.status.success() {
                let stderr = String::from_utf8_lossy(&ff.stderr);
                return Err(AppError::Git(format!(
                    "fast-forward failed: {}",
                    stderr.trim()
                )));
            }
            Ok(MergeOutcome::Merged)
        }
    }
}

/// Delete a local branch (`-D`, force). Used after a session is merged.
pub fn delete_branch(repo: &Path, branch: &str) -> Result<()> {
    run(repo, &["branch", "-D", branch])?;
    Ok(())
}

/// Fetch a pull request's head commit into a local `branch` (forced, so a
/// re-checkout picks up new pushes to the PR).
pub fn fetch_pr(repo: &Path, number: i64, branch: &str) -> Result<()> {
    run(
        repo,
        &[
            "fetch",
            "origin",
            &format!("pull/{number}/head:{branch}"),
            "--force",
        ],
    )?;
    Ok(())
}

/// Add a worktree at `dest` checked out to an existing `branch`.
pub fn add_worktree(repo: &Path, dest: &Path, branch: &str) -> Result<()> {
    let _ = run(repo, &["worktree", "prune"]);
    run(repo, &["worktree", "add", &dest.to_string_lossy(), branch])?;
    Ok(())
}

/// The commit a ref currently points at, if it resolves.
pub fn rev_parse(repo: &Path, rev: &str) -> Option<String> {
    run(repo, &["rev-parse", rev])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// The full textual diff of a worktree against `base` (a sha or branch) —
/// working-tree changes included — for handing to a review agent.
pub fn worktree_diff(worktree: &Path, base: &str) -> String {
    run(worktree, &["diff", base]).unwrap_or_default()
}

/// Whether the repo has at least one configured remote (a prerequisite for a PR).
pub fn has_remote(repo: &Path) -> bool {
    run(repo, &["remote"])
        .map(|o| !o.trim().is_empty())
        .unwrap_or(false)
}

/// The repo's `origin` remote as a browsable `https` URL (SSH forms and a `.git`
/// suffix normalized away), or `None` if there's no origin or it isn't a URL we
/// recognize.
pub fn remote_browse_url(repo: &Path) -> Option<String> {
    let raw = run(repo, &["remote", "get-url", "origin"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())?;
    normalize_remote_url(&raw)
}

/// Map a git remote URL to an `https` browser URL. Resolves `~/.ssh/config`
/// host aliases (so `git@gh-alias:owner/repo` lands on the real host):
///   `git@host:owner/repo(.git)`     → `https://host/owner/repo`
///   `ssh://git@host/owner/repo.git` → `https://host/owner/repo`
///   `https://host/owner/repo.git`   → `https://host/owner/repo`
fn normalize_remote_url(raw: &str) -> Option<String> {
    let url = raw.trim();
    let strip_git = |s: &str| s.strip_suffix(".git").unwrap_or(s).to_string();

    if let Some(rest) = url.strip_prefix("ssh://") {
        let rest = rest.strip_prefix("git@").unwrap_or(rest);
        if let Some((host, path)) = rest.split_once('/') {
            let host = host.split(':').next().unwrap_or(host); // drop any :port
            return Some(format!(
                "https://{}/{}",
                resolve_ssh_host(host),
                strip_git(path)
            ));
        }
        return Some(format!("https://{}", strip_git(rest)));
    }

    if url.starts_with("http://") || url.starts_with("https://") {
        return Some(strip_git(url));
    }

    // scp-like syntax: [git@]host:owner/repo — `host` is often an ssh alias.
    if let Some((before, path)) = url.split_once(':') {
        if !before.contains('/') && !path.is_empty() {
            let host = before.strip_prefix("git@").unwrap_or(before);
            return Some(format!(
                "https://{}/{}",
                resolve_ssh_host(host),
                strip_git(path)
            ));
        }
    }
    None
}

/// Resolve an ssh host that may be a `~/.ssh/config` alias to its real hostname
/// (via `ssh -G`); a host already containing a dot is assumed real. Strips a
/// leading `ssh.` (GitHub's port-443 alias host) when that leaves a domain.
fn resolve_ssh_host(host: &str) -> String {
    let real = if host.contains('.') {
        host.to_string()
    } else {
        let mut cmd = Command::new("ssh");
        cmd.args(["-G", host]);
        crate::platform::silent_command(&mut cmd);
        cmd.output()
            .ok()
            .and_then(|out| {
                String::from_utf8_lossy(&out.stdout)
                    .lines()
                    .find_map(|l| l.strip_prefix("hostname ").map(|h| h.trim().to_string()))
                    .filter(|h| !h.is_empty())
            })
            .unwrap_or_else(|| host.to_string())
    };
    match real.strip_prefix("ssh.") {
        Some(rest) if rest.contains('.') => rest.to_string(),
        _ => real,
    }
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
    let (op, abort): (Vec<&str>, &[&str]) = match mode {
        MergeMode::MergeCommit => (vec!["merge", "@{upstream}"], &["merge", "--abort"]),
        _ => (vec!["rebase", "@{upstream}"], &["rebase", "--abort"]),
    };
    let out = run_raw(worktree, &op)?;
    if !out.status.success() {
        let files = conflicted_files(worktree);
        let _ = run_raw(worktree, abort);
        return Ok(MergeOutcome::Conflict(files));
    }
    Ok(MergeOutcome::Merged)
}

/// Bring the worktree's branch up to date with `origin/<base>` by rebase (or
/// merge). Refuses on a dirty tree; aborts cleanly on conflict, leaving the
/// branch untouched. (Squash has no meaning here and is treated as rebase.)
pub fn sync_onto_base(worktree: &Path, base: &str, mode: MergeMode) -> Result<MergeOutcome> {
    if has_uncommitted_changes(worktree) {
        return Err(AppError::Git(
            "commit or discard the worktree's changes before syncing".to_string(),
        ));
    }
    let target = format!("origin/{base}");
    let (op, abort): (Vec<&str>, &[&str]) = match mode {
        MergeMode::MergeCommit => (vec!["merge", &target], &["merge", "--abort"]),
        _ => (vec!["rebase", &target], &["rebase", "--abort"]),
    };
    let out = run_raw(worktree, &op)?;
    if !out.status.success() {
        let files = conflicted_files(worktree);
        let _ = run_raw(worktree, abort);
        return Ok(MergeOutcome::Conflict(files));
    }
    Ok(MergeOutcome::Merged)
}
