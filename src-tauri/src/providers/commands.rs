//! Commands for the provider panel: list each agent CLI's install/auth status,
//! install/update warden's managed copy, and choose between the managed binary
//! and the one on the system PATH.

use tauri::{AppHandle, State};

use crate::cli::{self, Source, ToolStatus};
use crate::domain::Backend;
use crate::error::{AppError, CommandResult, Result};
use crate::providers;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn list_provider_status() -> CommandResult<Vec<ToolStatus>> {
    providers::status_all().await.map_err(Into::into)
}

/// Install warden's managed copy of a provider CLI (latest version).
#[tauri::command]
#[specta::specta]
pub async fn install_provider(app: AppHandle, id: String) -> CommandResult<()> {
    cli::install(&app, parse_provider(&id)?.tool(), None)
        .await
        .map_err(|e| AppError::Agent(e).into())
}

/// Reinstall the managed copy at the latest published version.
#[tauri::command]
#[specta::specta]
pub async fn update_provider(app: AppHandle, id: String) -> CommandResult<()> {
    install_provider(app, id).await
}

/// Choose where a provider's CLI comes from (`auto` | `managed` | `system`),
/// persisting the choice so it survives restarts.
#[tauri::command]
#[specta::specta]
pub async fn set_provider_source(
    state: State<'_, AppState>,
    id: String,
    source: String,
) -> CommandResult<()> {
    let tool = parse_provider(&id)?.tool();
    let source = Source::parse(&source)
        .ok_or_else(|| AppError::Invalid(format!("unknown CLI source: {source}")))?;
    state
        .store
        .set_setting(&Source::setting_key(tool), source.as_str())?;
    cli::set_source(tool, source);
    Ok(())
}

fn parse_provider(id: &str) -> Result<Backend> {
    Backend::parse(id).ok_or_else(|| AppError::Invalid(format!("unknown provider: {id}")))
}
