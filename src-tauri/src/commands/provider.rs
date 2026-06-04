//! Commands for the provider panel: list each agent CLI's install/auth status,
//! install/update warden's managed copy, and choose between the managed binary
//! and the one on the system PATH.

use tauri::{AppHandle, State};

use crate::cli::{self, Source, ToolStatus};
use crate::error::{AppError, Result};
use crate::providers::{self, Provider};
use crate::state::AppState;

#[tauri::command]
pub async fn list_provider_status() -> Result<Vec<ToolStatus>> {
    providers::status_all().await
}

/// Install warden's managed copy of a provider CLI (latest version).
#[tauri::command]
pub async fn install_provider(app: AppHandle, id: String) -> Result<()> {
    cli::install(&app, parse_provider(&id)?.tool(), None)
        .await
        .map_err(AppError::Agent)
}

/// Reinstall the managed copy at the latest published version.
#[tauri::command]
pub async fn update_provider(app: AppHandle, id: String) -> Result<()> {
    install_provider(app, id).await
}

/// Choose where a provider's CLI comes from (`auto` | `managed` | `system`),
/// persisting the choice so it survives restarts.
#[tauri::command]
pub async fn set_provider_source(
    state: State<'_, AppState>,
    id: String,
    source: String,
) -> Result<()> {
    let tool = parse_provider(&id)?.tool();
    let source = Source::parse(&source)
        .ok_or_else(|| AppError::Invalid(format!("unknown CLI source: {source}")))?;
    state
        .store
        .set_setting(&Source::setting_key(tool), source.as_str())?;
    cli::set_source(tool, source);
    Ok(())
}

fn parse_provider(id: &str) -> Result<Provider> {
    Provider::parse(id).ok_or_else(|| AppError::Invalid(format!("unknown provider: {id}")))
}
