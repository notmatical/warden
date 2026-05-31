//! Decides where a session's agent runs: an isolated git worktree for git
//! workspaces, or the workspace root in-place otherwise.

use std::fs;

use tauri::{AppHandle, Manager};

use crate::domain::Workspace;
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

/// Provision a working directory for a new session. Git workspaces get a fresh
/// worktree on a `warden/<short-id>` branch rooted at the current HEAD; other
/// workspaces run directly in their own path.
pub fn provision_working_dir(app: &AppHandle, ws: &Workspace) -> Result<ProvisionedDir> {
    let repo = std::path::Path::new(&ws.path);
    if ws.is_git && git::is_repo(repo) {
        let base = git::head_sha(repo)?;
        let id = uuid();
        let branch = format!("warden/{}", short_id(&id, 8));
        let dest = app
            .path()
            .app_data_dir()?
            .join("worktrees")
            .join(&id);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)?;
        }
        git::create_worktree(repo, &dest, &branch, &base)?;
        return Ok(ProvisionedDir {
            working_dir: dest.to_string_lossy().into_owned(),
            branch: Some(branch),
            base_sha: Some(base),
            is_isolated: true,
        });
    }

    Ok(ProvisionedDir {
        working_dir: ws.path.clone(),
        branch: None,
        base_sha: None,
        is_isolated: false,
    })
}
