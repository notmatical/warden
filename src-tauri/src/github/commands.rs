//! Commands for managing the GitHub CLI: its status, installing/updating the
//! managed copy, choosing between managed and system PATH, and opening/refreshing
//! a session's pull request.

use std::path::Path;

use tauri::{AppHandle, State};

use crate::cli::{self, Source, Tool, ToolStatus};
use crate::error::{AppError, Result};
use crate::events::emit_session;
use crate::github::pr::{self, PrInfo};
use crate::state::AppState;

#[tauri::command]
pub async fn github_status() -> Result<ToolStatus> {
    Ok(crate::github::status().await)
}

/// Install warden's managed copy of the GitHub CLI (latest version).
#[tauri::command]
pub async fn install_github_cli(app: AppHandle) -> Result<()> {
    cli::install(&app, Tool::Gh, None)
        .await
        .map_err(AppError::Agent)
}

/// Reinstall the managed GitHub CLI at the latest published version.
#[tauri::command]
pub async fn update_github_cli(app: AppHandle) -> Result<()> {
    install_github_cli(app).await
}

/// Choose where the GitHub CLI comes from (`auto` | `managed` | `system`).
#[tauri::command]
pub async fn set_github_source(state: State<'_, AppState>, source: String) -> Result<()> {
    let source = Source::parse(&source)
        .ok_or_else(|| AppError::Invalid(format!("unknown CLI source: {source}")))?;
    state
        .store
        .set_setting(&Source::setting_key(Tool::Gh), source.as_str())?;
    cli::set_source(Tool::Gh, source);
    Ok(())
}

/// Commit the session's work, push its branch, and open a pull request against
/// the session's base branch.
#[tauri::command]
pub async fn open_pull_request(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    title: String,
    body: String,
) -> Result<PrInfo> {
    let session = state.store.get_session(&session_id)?;
    if session.merged_at.is_some() {
        return Err(AppError::Invalid("session is already merged".to_string()));
    }
    if !session.is_isolated {
        return Err(AppError::Invalid(
            "only isolated worktree sessions can open a PR".to_string(),
        ));
    }
    let base = session
        .base_branch
        .clone()
        .ok_or_else(|| AppError::Invalid("session has no base branch".to_string()))?;

    let project = state.store.get_project(&session.project_id)?;
    let repo = Path::new(&project.path);
    let worktree = Path::new(&session.working_dir);
    if !crate::git::has_remote(repo) {
        return Err(AppError::Invalid(
            "this repository has no git remote to push to".to_string(),
        ));
    }

    // Stop any in-flight work so the worktree isn't mutated mid-push.
    state.manager.cancel(&app, &state.store, &session_id);
    crate::terminal::kill(&session_id);

    let title = if title.trim().is_empty() {
        session.title.clone()
    } else {
        title
    };
    let _ = crate::git::stage_and_commit(worktree, &title)?;
    crate::git::push_branch(worktree)?;
    let info = pr::create_pr(worktree, &base, &title, &body)?;

    state.store.set_session_pr(
        &session_id,
        info.number,
        &info.url,
        &info.state,
        info.check_status,
    )?;
    if let Ok(updated) = state.store.get_session(&session_id) {
        emit_session(&app, &updated);
    }
    Ok(info)
}

/// Re-read the session branch's pull request state from GitHub.
#[tauri::command]
pub async fn refresh_pr_status(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Option<PrInfo>> {
    let session = state.store.get_session(&session_id)?;
    let info = pr::status(Path::new(&session.working_dir))?;
    if let Some(ref info) = info {
        state.store.set_session_pr(
            &session_id,
            info.number,
            &info.url,
            &info.state,
            info.check_status,
        )?;
        if let Ok(updated) = state.store.get_session(&session_id) {
            emit_session(&app, &updated);
        }
    }
    Ok(info)
}

/// Merge the session's open PR from the app, then clean up the worktree and
/// branch and mark the session merged — mirroring local integrate cleanup.
#[tauri::command]
pub async fn merge_pull_request(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    strategy: String,
) -> Result<()> {
    let session = state.store.get_session(&session_id)?;
    if session.merged_at.is_some() {
        return Err(AppError::Invalid("session is already merged".to_string()));
    }
    if session.pr_number.is_none() {
        return Err(AppError::Invalid(
            "session has no open pull request".to_string(),
        ));
    }
    let branch = session
        .branch
        .clone()
        .ok_or_else(|| AppError::Invalid("session has no branch".to_string()))?;
    let mode = crate::git::MergeMode::parse(&strategy)
        .ok_or_else(|| AppError::Invalid(format!("unknown merge strategy: {strategy}")))?;

    let project = state.store.get_project(&session.project_id)?;
    let repo = std::path::Path::new(&project.path);
    let worktree = std::path::Path::new(&session.working_dir);

    // Stop in-flight work, then merge the PR on GitHub.
    state.manager.cancel(&app, &state.store, &session_id);
    crate::terminal::kill(&session_id);
    crate::github::pr::merge(worktree, mode)?;

    // Land & clean up locally (best-effort; the PR is already merged).
    let _ = crate::git::remove_worktree(repo, worktree);
    let _ = crate::git::delete_branch(repo, &branch);
    state.store.mark_session_merged(&session_id)?;
    if let Ok(updated) = state.store.get_session(&session_id) {
        emit_session(&app, &updated);
    }
    Ok(())
}
