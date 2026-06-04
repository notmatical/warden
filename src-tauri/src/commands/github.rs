//! Commands for managing the GitHub CLI: its status, installing/updating the
//! managed copy, and choosing between managed and system PATH.

use tauri::{AppHandle, State};

use crate::cli::{self, Source, Tool, ToolStatus};
use crate::error::{AppError, Result};
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
