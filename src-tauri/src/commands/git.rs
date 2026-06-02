//! Git status command: per-root branch and change counts for a session's repos,
//! so the workspace can surface how each root has diverged.

use std::path::Path;

use serde::Serialize;
use tauri::State;

use crate::error::Result;
use crate::git;
use crate::state::AppState;

/// Branch and divergence summary for one of a session's repo roots.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    pub project_id: String,
    pub name: String,
    pub path: String,
    pub is_primary: bool,
    pub is_git: bool,
    pub branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub uncommitted_added: u32,
    pub uncommitted_removed: u32,
}

/// Git status for every root of a session. The primary root reads from the
/// session's `working_dir` (which may be an isolated worktree); other roots read
/// from their project path. Non-git roots come back zeroed rather than erroring.
#[tauri::command]
pub async fn session_git_status(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<RepoStatus>> {
    let session = state.store.get_session(&session_id)?;
    let projects = state.store.list_session_root_projects(&session_id)?;

    let mut out = Vec::with_capacity(projects.len());
    for project in projects {
        let is_primary = project.id == session.project_id;
        let cwd = if is_primary {
            session.working_dir.clone()
        } else {
            project.path.clone()
        };
        let dir = Path::new(&cwd);

        let mut status = RepoStatus {
            project_id: project.id,
            name: project.name,
            path: project.path,
            is_primary,
            is_git: false,
            branch: None,
            ahead: 0,
            behind: 0,
            uncommitted_added: 0,
            uncommitted_removed: 0,
        };

        if git::is_repo(dir) {
            let (added, removed) = git::uncommitted_lines(dir);
            let (ahead, behind) = git::ahead_behind(dir);
            status.is_git = true;
            status.branch = git::current_branch(dir);
            status.ahead = ahead;
            status.behind = behind;
            status.uncommitted_added = added;
            status.uncommitted_removed = removed;
        }

        out.push(status);
    }

    Ok(out)
}
