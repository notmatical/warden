//! Project commands: listing, opening (validate + upsert), and the sessions
//! within a project.

use std::path::Path;

use tauri::State;

use crate::domain::{Project, Session};
use crate::error::{AppError, CommandResult};
use crate::git;
use crate::state::AppState;

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
