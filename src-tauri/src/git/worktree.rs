//! Decides where a session's agent runs: an isolated git worktree when the
//! caller asks for one, or the project's own checkout otherwise.

use std::fs;
use std::path::{Path, PathBuf};

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

/// Root for isolated worktrees: `<repo>/.warden/worktrees`. Lives inside the
/// project — alongside `.warden/config.json` — so worktrees travel and die
/// with the repo instead of accumulating under the home dir.
fn worktrees_root(repo: &Path) -> PathBuf {
    repo.join(".warden").join("worktrees")
}

/// Create the worktrees root with a self-ignoring `.gitignore`, so the nested
/// checkouts never appear as untracked files in the main repo.
fn ensure_worktrees_root(repo: &Path) -> Result<PathBuf> {
    let root = worktrees_root(repo);
    fs::create_dir_all(&root)?;
    let gitignore = root.join(".gitignore");
    if !gitignore.exists() {
        fs::write(&gitignore, "*\n")?;
    }
    Ok(root)
}

/// Whether `path` lives under warden's worktrees root — the only place warden
/// is allowed to delete. A session pointed at any external directory (explicit
/// working_dir, imported checkout) is never removed.
pub fn is_managed_worktree(repo: &Path, path: &Path) -> bool {
    path.starts_with(worktrees_root(repo))
}

/// Provision an isolated worktree checked out to an existing PR's head branch,
/// for reviewing it. `base` is the PR's base branch (its merge target).
pub fn provision_pr_worktree(project: &Project, number: i64, base: &str) -> Result<ProvisionedDir> {
    let repo = Path::new(&project.path);
    let branch = format!("warden-pr-{number}");
    git::fetch_pr(repo, number, &branch)?;

    let dest = ensure_worktrees_root(repo)?.join(format!("pr-{number}"));
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
///   branch under `<repo>/.warden/worktrees/<short>`, rooted at the current HEAD.
pub fn provision_working_dir(
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
    // A taken hint gets a `-<short>` suffix since `worktree add -b` refuses
    // existing branches. The directory segment is always sanitized + uniquified.
    let hint = branch_hint.map(str::trim).filter(|b| !b.is_empty());
    let branch = match hint {
        Some(b) if git::branch_exists(repo, b) => format!("{b}-{short}"),
        Some(b) => b.to_string(),
        None => format!("warden/{short}"),
    };
    let dir_seg = match hint {
        Some(b) => format!("{}-{short}", sanitize(b)),
        None => short.clone(),
    };
    let dest = ensure_worktrees_root(repo)?.join(&dir_seg);
    git::create_worktree(repo, &dest, &branch, &base)?;

    Ok(ProvisionedDir {
        working_dir: dest.to_string_lossy().into_owned(),
        branch: Some(branch),
        base_sha: Some(base),
        base_branch,
        is_isolated: true,
    })
}
