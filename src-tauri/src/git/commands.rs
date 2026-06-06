//! Git status command: per-root branch and change counts for a session's repos,
//! so the workspace can surface how each root has diverged.

use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::error::{AppError, Result};
use crate::events::emit_session;
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
    /// Whether this root's repo has a remote — i.e. a PR can be opened from it.
    pub has_remote: bool,
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
            has_remote: false,
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
            status.has_remote = git::has_remote(dir);
        }

        out.push(status);
    }

    Ok(out)
}

/// The result of folding a session's branch into its base.
#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum IntegrateOutcome {
    Merged,
    /// The merge stopped on conflicts (and was aborted); these files clashed.
    Conflict {
        files: Vec<String>,
    },
}

/// Fold a session's worktree branch back into its base branch, then remove the
/// worktree + branch and mark the session merged. On conflict nothing changes
/// and the clashing files are returned for the user to resolve.
#[tauri::command]
pub async fn integrate_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    message: Option<String>,
    mode: Option<String>,
) -> Result<IntegrateOutcome> {
    let session = state.store.get_session(&session_id)?;
    if session.merged_at.is_some() {
        return Err(AppError::Invalid("session is already merged".to_string()));
    }
    if !session.is_isolated {
        return Err(AppError::Invalid(
            "only isolated worktree sessions can be merged".to_string(),
        ));
    }
    let branch = session
        .branch
        .clone()
        .ok_or_else(|| AppError::Invalid("session has no branch".to_string()))?;
    let base = session
        .base_branch
        .clone()
        .ok_or_else(|| AppError::Invalid("session has no base branch to merge into".to_string()))?;

    let project = state.store.get_project(&session.project_id)?;
    let repo = Path::new(&project.path);
    let worktree = Path::new(&session.working_dir);

    let mode = mode
        .as_deref()
        .and_then(git::MergeMode::parse)
        .unwrap_or(git::MergeMode::Squash);
    let message = message
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| session.title.clone());

    // Stop any in-flight agent turn or PTY so the worktree isn't mutated/locked.
    state.manager.cancel(&app, &state.store, &session_id);
    crate::terminal::kill(&session_id);

    // Commit the worktree's working changes onto its branch first.
    git::stage_and_commit(worktree, &message)?;

    if !git::has_changes_to_integrate(repo, &branch, &base) {
        return Err(AppError::Invalid(
            "nothing to merge — the session has no changes over its base".to_string(),
        ));
    }

    match git::merge_into_base(repo, worktree, &branch, &base, mode, &message)? {
        git::MergeOutcome::Conflict(files) => Ok(IntegrateOutcome::Conflict { files }),
        git::MergeOutcome::Merged => {
            let _ = git::remove_worktree(repo, worktree);
            let _ = git::delete_branch(repo, &branch);
            state.store.mark_session_merged(&session_id)?;
            if let Ok(updated) = state.store.get_session(&session_id) {
                emit_session(&app, &updated);
            }
            Ok(IntegrateOutcome::Merged)
        }
    }
}

/// Every change a session has made since it forked, for the diff view. Empty
/// when the session has no base commit (non-git or merged).
#[tauri::command]
pub async fn get_session_diff(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<git::diff::DiffFile>> {
    let session = state.store.get_session(&session_id)?;
    let Some(base) = session.base_sha.as_deref() else {
        return Ok(Vec::new());
    };
    git::diff::worktree_diff(Path::new(&session.working_dir), base)
}

/// The commits a session has made on its branch since it forked from base.
#[tauri::command]
pub async fn get_session_commits(
    state: State<'_, AppState>,
    session_id: String,
    limit: Option<u32>,
) -> Result<Vec<git::diff::Commit>> {
    let session = state.store.get_session(&session_id)?;
    let Some(base) = session.base_sha.as_deref() else {
        return Ok(Vec::new());
    };
    git::diff::commits_since(Path::new(&session.working_dir), base, limit.unwrap_or(100))
}

/// Result of syncing a worktree with its base branch.
#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SyncOutcome {
    Synced,
    Conflict { files: Vec<String> },
}

/// Bring a session's worktree up to date with the latest base branch (fetch +
/// rebase by default). Aborts cleanly and reports files on conflict.
#[tauri::command]
pub async fn sync_worktree(
    state: State<'_, AppState>,
    session_id: String,
    mode: Option<String>,
) -> Result<SyncOutcome> {
    let session = state.store.get_session(&session_id)?;
    if session.merged_at.is_some() {
        return Err(AppError::Invalid("session is already merged".to_string()));
    }
    if !session.is_isolated {
        return Err(AppError::Invalid(
            "only isolated worktree sessions can sync".to_string(),
        ));
    }
    let base = session
        .base_branch
        .clone()
        .ok_or_else(|| AppError::Invalid("session has no base branch".to_string()))?;
    let worktree = Path::new(&session.working_dir);
    let mode = mode
        .as_deref()
        .and_then(git::MergeMode::parse)
        .unwrap_or(git::MergeMode::Rebase);

    git::fetch_origin(worktree, &base);
    match git::sync_onto_base(worktree, &base, mode)? {
        git::MergeOutcome::Conflict(files) => Ok(SyncOutcome::Conflict { files }),
        git::MergeOutcome::Merged => Ok(SyncOutcome::Synced),
    }
}

/// Push the session's worktree branch to its origin remote (publishing or
/// updating the upstream tracking branch).
#[tauri::command]
pub async fn push_session(state: State<'_, AppState>, session_id: String) -> Result<()> {
    let session = state.store.get_session(&session_id)?;
    git::push_branch(Path::new(&session.working_dir))
}

/// Pull the latest upstream commits onto the session's branch (fetch + merge).
/// Reports clashing files on conflict, like `sync_worktree`.
#[tauri::command]
pub async fn pull_session(state: State<'_, AppState>, session_id: String) -> Result<SyncOutcome> {
    let session = state.store.get_session(&session_id)?;
    let worktree = Path::new(&session.working_dir);
    match git::pull_upstream(worktree, git::MergeMode::MergeCommit)? {
        git::MergeOutcome::Conflict(files) => Ok(SyncOutcome::Conflict { files }),
        git::MergeOutcome::Merged => Ok(SyncOutcome::Synced),
    }
}

/// The browsable `https` URL for a repo path's `origin` remote, or `None` when
/// there's no recognizable remote. Powers the header's "open repo" button.
#[tauri::command]
pub async fn repo_browse_url(path: String) -> Result<Option<String>> {
    Ok(git::remote_browse_url(Path::new(&path)))
}
