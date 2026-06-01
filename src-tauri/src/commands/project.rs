//! Project commands: listing, opening (validate + upsert), and the sessions
//! within a project.

use std::path::Path;

use tauri::State;

use crate::domain::{Session, Project};
use crate::error::{AppError, Result};
use crate::git;
use crate::state::AppState;

#[tauri::command]
pub async fn list_projects(state: State<'_, AppState>) -> Result<Vec<Project>> {
    state.store.list_projects()
}

#[tauri::command]
pub async fn open_project(state: State<'_, AppState>, path: String) -> Result<Project> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(AppError::Invalid(format!("path does not exist: {path}")));
    }
    let name = p
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&path)
        .to_string();
    let is_git = git::is_repo(p);
    state.store.upsert_project(&name, &path, is_git)
}

#[tauri::command]
pub async fn list_sessions(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<Session>> {
    state.store.list_sessions(&project_id)
}
