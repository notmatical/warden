//! Provider-panel command wrappers: list each agent CLI's install/auth status,
//! install/update warden's managed copy, and choose between the managed binary
//! and the one on the system PATH. Logic lives in `warden_core::{provider, cli}`.

use tauri::State;

use warden_core::cli::{self, Source, Tool, ToolStatus};
use warden_core::error::Result;
use warden_core::provider::{self, opencode};
use warden_core::{AppError, Backend, CommandResult};

use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn list_provider_status() -> CommandResult<Vec<ToolStatus>> {
    provider::status_all().await.map_err(Into::into)
}

/// The models the local OpenCode install can run (connected providers only) —
/// the picker's OpenCode pane, since availability is per-account.
#[tauri::command]
#[specta::specta]
pub async fn list_opencode_models() -> CommandResult<Vec<opencode::models::OpencodeModel>> {
    opencode::models::list().await.map_err(Into::into)
}

/// Install warden's managed copy of a provider CLI (latest version).
#[tauri::command]
#[specta::specta]
pub async fn install_provider(id: String) -> CommandResult<()> {
    cli::install(provider_tool(&id)?, None)
        .await
        .map_err(Into::into)
}

/// Reinstall the managed copy at the latest published version.
#[tauri::command]
#[specta::specta]
pub async fn update_provider(id: String) -> CommandResult<()> {
    install_provider(id).await
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
    let tool = provider_tool(&id)?;
    let source = Source::parse(&source)
        .ok_or_else(|| AppError::Invalid(format!("unknown CLI source: {source}")))?;
    state
        .store
        .set_setting(&Source::setting_key(tool), source.as_str())?;
    cli::set_source(tool, source);
    Ok(())
}

/// The managed CLI tool a provider id maps to, via the provider registry.
fn provider_tool(id: &str) -> Result<Tool> {
    let backend = Backend::parse(id)
        .ok_or_else(|| AppError::Invalid(format!("unknown provider: {id}")))?;
    Ok(provider::provider(backend).cli_tool())
}
