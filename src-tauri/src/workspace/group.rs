//! Group commands: the top-level workspace (a named set of project roots and a
//! saved pane layout) plus the per-session root selection that drives which
//! repos an agent pulls into context.

use std::path::Path;

use tauri::State;

use crate::domain::{Group, Project, Session};
use crate::error::{AppError, Result};
use crate::git;
use crate::state::AppState;

#[tauri::command]
pub async fn list_groups(state: State<'_, AppState>) -> Result<Vec<Group>> {
    state.store.list_groups()
}

#[tauri::command]
pub async fn create_group(state: State<'_, AppState>, name: String) -> Result<Group> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("group name is required".to_string()));
    }
    state.store.create_group(name)
}

#[tauri::command]
pub async fn rename_group(
    state: State<'_, AppState>,
    group_id: String,
    name: String,
) -> Result<Group> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("group name is required".to_string()));
    }
    state.store.rename_group(&group_id, name)?;
    state.store.get_group(&group_id)
}

#[tauri::command]
pub async fn delete_group(state: State<'_, AppState>, group_id: String) -> Result<()> {
    state.store.delete_group(&group_id)
}

#[tauri::command]
pub async fn set_group_layout(
    state: State<'_, AppState>,
    group_id: String,
    layout: String,
) -> Result<()> {
    state.store.update_group_layout(&group_id, &layout)
}

#[tauri::command]
pub async fn list_group_roots(
    state: State<'_, AppState>,
    group_id: String,
) -> Result<Vec<Project>> {
    state.store.list_group_roots(&group_id)
}

#[tauri::command]
pub async fn list_group_sessions(
    state: State<'_, AppState>,
    group_id: String,
) -> Result<Vec<Session>> {
    state.store.list_group_sessions(&group_id)
}

/// Add a folder to a group as a root, opening/registering the project first.
#[tauri::command]
pub async fn add_group_root(
    state: State<'_, AppState>,
    group_id: String,
    path: String,
) -> Result<Project> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(AppError::Invalid(format!("path does not exist: {path}")));
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
pub async fn remove_group_root(
    state: State<'_, AppState>,
    group_id: String,
    project_id: String,
) -> Result<()> {
    state.store.remove_group_root(&group_id, &project_id)
}

/// The repos a session pulls into context, primary first.
#[tauri::command]
pub async fn list_session_roots(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<Project>> {
    state.store.list_session_root_projects(&session_id)
}

/// Replace a session's non-primary roots (selected from the group's roots).
#[tauri::command]
pub async fn set_session_roots(
    state: State<'_, AppState>,
    session_id: String,
    project_ids: Vec<String>,
) -> Result<Vec<Project>> {
    state.store.set_session_roots(&session_id, &project_ids)?;
    state.store.list_session_root_projects(&session_id)
}
