//! Tauri commands for workspace structure: projects, groups, per-session root
//! selection, and per-repo config. Supporting logic for `.warden/config.json`
//! lives in [`super::config`].

use std::path::Path;

use tauri::State;

use crate::domain::{Group, Project, Session};
use crate::error::{AppError, CommandResult};
use crate::git;
use crate::state::AppState;

use super::config::{self, WorktreeConfig};

// --- Projects ---------------------------------------------------------------

#[tauri::command]
#[specta::specta]
pub async fn list_projects(state: State<'_, AppState>) -> CommandResult<Vec<Project>> {
    state.store.list_projects().map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn open_project(state: State<'_, AppState>, path: String) -> CommandResult<Project> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(AppError::Invalid(format!("path does not exist: {path}")).into());
    }
    let name = p
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&path)
        .to_string();
    let is_git = git::is_repo(p);
    state
        .store
        .upsert_project(&name, &path, is_git)
        .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn list_sessions(
    state: State<'_, AppState>,
    project_id: String,
) -> CommandResult<Vec<Session>> {
    state.store.list_sessions(&project_id).map_err(Into::into)
}

// --- Groups -----------------------------------------------------------------

#[tauri::command]
#[specta::specta]
pub async fn list_groups(state: State<'_, AppState>) -> CommandResult<Vec<Group>> {
    state.store.list_groups().map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn create_group(state: State<'_, AppState>, name: String) -> CommandResult<Group> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("group name is required".to_string()).into());
    }
    state.store.create_group(name).map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn rename_group(
    state: State<'_, AppState>,
    group_id: String,
    name: String,
) -> CommandResult<Group> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("group name is required".to_string()).into());
    }
    state.store.rename_group(&group_id, name)?;
    state.store.get_group(&group_id).map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn delete_group(state: State<'_, AppState>, group_id: String) -> CommandResult<()> {
    state.store.delete_group(&group_id).map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn set_group_layout(
    state: State<'_, AppState>,
    group_id: String,
    layout: String,
) -> CommandResult<()> {
    state
        .store
        .update_group_layout(&group_id, &layout)
        .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn list_group_roots(
    state: State<'_, AppState>,
    group_id: String,
) -> CommandResult<Vec<Project>> {
    state.store.list_group_roots(&group_id).map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn list_group_sessions(
    state: State<'_, AppState>,
    group_id: String,
) -> CommandResult<Vec<Session>> {
    state
        .store
        .list_group_sessions(&group_id)
        .map_err(Into::into)
}

/// Add a folder to a group as a root, opening/registering the project first.
#[tauri::command]
#[specta::specta]
pub async fn add_group_root(
    state: State<'_, AppState>,
    group_id: String,
    path: String,
) -> CommandResult<Project> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(AppError::Invalid(format!("path does not exist: {path}")).into());
    }
    let name = p
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&path)
        .to_string();
    let project = state.store.upsert_project(&name, &path, git::is_repo(p))?;
    state.store.add_group_root(&group_id, &project.id)?;
    Ok(project)
}

#[tauri::command]
#[specta::specta]
pub async fn remove_group_root(
    state: State<'_, AppState>,
    group_id: String,
    project_id: String,
) -> CommandResult<()> {
    state
        .store
        .remove_group_root(&group_id, &project_id)
        .map_err(Into::into)
}

/// The repos a session pulls into context, primary first.
#[tauri::command]
#[specta::specta]
pub async fn list_session_roots(
    state: State<'_, AppState>,
    session_id: String,
) -> CommandResult<Vec<Project>> {
    state
        .store
        .list_session_root_projects(&session_id)
        .map_err(Into::into)
}

/// Replace a session's non-primary roots (selected from the group's roots).
#[tauri::command]
#[specta::specta]
pub async fn set_session_roots(
    state: State<'_, AppState>,
    session_id: String,
    project_ids: Vec<String>,
) -> CommandResult<Vec<Project>> {
    state.store.set_session_roots(&session_id, &project_ids)?;
    state
        .store
        .list_session_root_projects(&session_id)
        .map_err(Into::into)
}

// --- Repo config ------------------------------------------------------------

#[tauri::command]
#[specta::specta]
pub async fn get_worktree_config(
    state: State<'_, AppState>,
    project_id: String,
) -> CommandResult<WorktreeConfig> {
    let project = state.store.get_project(&project_id)?;
    config::load(Path::new(&project.path)).map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn update_worktree_config(
    state: State<'_, AppState>,
    project_id: String,
    config: WorktreeConfig,
) -> CommandResult<WorktreeConfig> {
    let project = state.store.get_project(&project_id)?;
    let config = WorktreeConfig {
        setup: config::clean(config.setup),
        teardown: config::clean(config.teardown),
    };
    config::save(Path::new(&project.path), &config)?;
    Ok(config)
}
