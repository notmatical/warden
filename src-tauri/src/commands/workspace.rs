//! Workspace commands: listing, opening (validate + upsert), and the sessions
//! within a workspace.

use std::path::Path;

use tauri::State;

use crate::domain::{Session, Workspace};
use crate::error::{AppError, Result};
use crate::git;
use crate::state::AppState;

#[tauri::command]
pub async fn list_workspaces(state: State<'_, AppState>) -> Result<Vec<Workspace>> {
    state.store.list_workspaces()
}

#[tauri::command]
pub async fn open_workspace(state: State<'_, AppState>, path: String) -> Result<Workspace> {
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
    state.store.upsert_workspace(&name, &path, is_git)
}

#[tauri::command]
pub async fn list_sessions(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<Session>> {
    state.store.list_sessions(&workspace_id)
}
