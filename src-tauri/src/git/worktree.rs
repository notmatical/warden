//! Decides where a session's agent runs: an isolated git worktree when the
//! caller asks for one, or the project's own checkout otherwise.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::domain::Project;
use crate::error::Result;
use crate::util::{short_id, uuid};

use super::cli as git;

/// The working directory chosen for a session, plus the git context it carries.
#[derive(Clone)]
pub struct ProvisionedDir {
    pub working_dir: String,
    pub branch: Option<String>,
    pub base_sha: Option<String>,
    /// The repo branch this session was rooted on — its merge target.
    pub base_branch: Option<String>,
    pub is_isolated: bool,
}

/// Root for isolated worktrees: `~/warden`. Visible and grouped per repo, rather
/// than buried under the app-data dir.
fn worktrees_root(app: &AppHandle) -> Result<PathBuf> {
    Ok(app.path().home_dir()?.join("warden"))
}

/// Whether `path` lives under warden's worktrees root — the only place warden
/// is allowed to delete. A session pointed at any external directory (explicit
/// working_dir, imported checkout) is never removed.
pub fn is_managed_worktree(app: &AppHandle, path: &Path) -> bool {
    worktrees_root(app)
        .map(|root| path.starts_with(&root))
        .unwrap_or(false)
}

/// Provision an isolated worktree checked out to an existing PR's head branch,
/// for reviewing it. `base` is the PR's base branch (its merge target).
pub fn provision_pr_worktree(
    app: &AppHandle,
    project: &Project,
    number: i64,
    base: &str,
) -> Result<ProvisionedDir> {
    let repo = Path::new(&project.path);
    let branch = format!("warden-pr-{number}");
    git::fetch_pr(repo, number, &branch)?;

    let dest = worktrees_root(app)?
        .join(sanitize(&project.name))
        .join(format!("pr-{number}"));
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    git::add_worktree(repo, &dest, &branch)?;

    Ok(ProvisionedDir {
        working_dir: dest.to_string_lossy().into_owned(),
        branch: Some(branch),
        // Diff/sync against the PR's base tip.
        base_sha: git::rev_parse(repo, base),
        base_branch: Some(base.to_string()),
        is_isolated: true,
    })
}

/// Reduce a name to a filesystem-safe directory segment.
fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('-');
    if trimmed.is_empty() {
        "repo".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Provision a working directory for a new session.
///
/// - Non-git project → runs in place, no diff base.
/// - Git project, `isolate = false` → runs in the repo's main checkout, but
///   still records the current HEAD so the UI can show a read-only diff.
/// - Git project, `isolate = true` → a fresh worktree on a `warden/<short>`
///   branch under `~/warden/<repo>/<short>`, rooted at the current HEAD.
pub fn provision_working_dir(
    app: &AppHandle,
    ws: &Project,
    isolate: bool,
    branch_hint: Option<&str>,
) -> Result<ProvisionedDir> {
    let repo = Path::new(&ws.path);

    if !(ws.is_git && git::is_repo(repo)) {
        return Ok(ProvisionedDir {
            working_dir: ws.path.clone(),
            branch: None,
            base_sha: None,
            base_branch: None,
            is_isolated: false,
        });
    }

    let base = git::head_sha(repo)?;
    let base_branch = git::current_branch(repo);

    if !isolate {
        return Ok(ProvisionedDir {
            working_dir: ws.path.clone(),
            branch: None,
            base_sha: Some(base),
            base_branch,
            is_isolated: false,
        });
    }

    let short = short_id(&uuid(), 8);
    // A caller-named branch (e.g. `feat/x`) wins; otherwise `warden/<short>`.
    // The directory segment is always sanitized + uniquified with `short`.
    let hint = branch_hint.map(str::trim).filter(|b| !b.is_empty());
    let branch = hint
        .map(str::to_string)
        .unwrap_or_else(|| format!("warden/{short}"));
    let dir_seg = match hint {
        Some(b) => format!("{}-{short}", sanitize(b)),
        None => short.clone(),
    };
    let dest = worktrees_root(app)?.join(sanitize(&ws.name)).join(&dir_seg);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    git::create_worktree(repo, &dest, &branch, &base)?;

    Ok(ProvisionedDir {
        working_dir: dest.to_string_lossy().into_owned(),
        branch: Some(branch),
        base_sha: Some(base),
        base_branch,
        is_isolated: true,
    })
}
