//! Decides where a session's agent runs: an isolated git worktree when the
//! caller asks for one, or the project's own checkout otherwise.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::domain::Project;
use crate::error::Result;
use crate::git;
use crate::util::{short_id, uuid};

/// The working directory chosen for a session, plus the git context it carries.
pub struct ProvisionedDir {
    pub working_dir: String,
    pub branch: Option<String>,
    pub base_sha: Option<String>,
    pub is_isolated: bool,
}

/// Root for isolated worktrees: `~/warden`. Visible and grouped per repo, rather
/// than buried under the app-data dir.
fn worktrees_root(app: &AppHandle) -> Result<PathBuf> {
    Ok(app.path().home_dir()?.join("warden"))
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
) -> Result<ProvisionedDir> {
    let repo = Path::new(&ws.path);

    if !(ws.is_git && git::is_repo(repo)) {
        return Ok(ProvisionedDir {
            working_dir: ws.path.clone(),
            branch: None,
            base_sha: None,
            is_isolated: false,
        });
    }

    let base = git::head_sha(repo)?;

    if !isolate {
        return Ok(ProvisionedDir {
            working_dir: ws.path.clone(),
            branch: None,
            base_sha: Some(base),
            is_isolated: false,
        });
    }

    let short = short_id(&uuid(), 8);
    let branch = format!("warden/{short}");
    let dest = worktrees_root(app)?.join(sanitize(&ws.name)).join(&short);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    git::create_worktree(repo, &dest, &branch, &base)?;

    Ok(ProvisionedDir {
        working_dir: dest.to_string_lossy().into_owned(),
        branch: Some(branch),
        base_sha: Some(base),
        is_isolated: true,
    })
}
