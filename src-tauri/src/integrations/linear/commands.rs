//! Tauri commands for the Linear integration: connect (validate + store key),
//! disconnect, report connection status, read the cached inbox, and force a sync.

use serde::Serialize;
use specta::Type;
use tauri::State;

use crate::error::{AppError, CommandResult};
use crate::state::AppState;

use super::client::{self, LinearIssue, Viewer};
use super::{key, sync};

/// Connection state for the Tasks UI.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LinearStatus {
    pub connected: bool,
}

/// Validate a personal API key against Linear and, on success, store it in the
/// OS keychain and do a best-effort initial sync. Returns the authenticated user.
#[tauri::command]
#[specta::specta]
pub async fn linear_connect(state: State<'_, AppState>, key: String) -> CommandResult<Viewer> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err(AppError::Invalid("Linear API key is empty".into()).into());
    }
    let viewer = client::fetch_viewer(&key).await?;
    key::store(&key)?;
    // Populate the cache so the inbox isn't empty on first open; non-fatal.
    let _ = sync::sync_once(&state.store, &key).await;
    Ok(viewer)
}

/// Forget the stored API key and clear the cached inbox.
#[tauri::command]
#[specta::specta]
pub async fn linear_disconnect(state: State<'_, AppState>) -> CommandResult<()> {
    key::clear()?;
    state.store.replace_linear_issues(&[])?;
    Ok(())
}

/// Whether a Linear key is stored (no network call).
#[tauri::command]
#[specta::specta]
pub async fn linear_status() -> CommandResult<LinearStatus> {
    Ok(LinearStatus {
        connected: key::load()?.is_some(),
    })
}

/// The cached inbox (assigned issues), read from the local DB — instant, offline.
#[tauri::command]
#[specta::specta]
pub async fn linear_cached_issues(state: State<'_, AppState>) -> CommandResult<Vec<LinearIssue>> {
    Ok(sync::cached_issues(&state.store)?)
}

/// Force a sync against Linear and return the freshened cache.
#[tauri::command]
#[specta::specta]
pub async fn linear_sync_now(state: State<'_, AppState>) -> CommandResult<Vec<LinearIssue>> {
    let key = key::load()?.ok_or_else(|| AppError::Invalid("not connected to Linear".into()))?;
    sync::sync_once(&state.store, &key).await?;
    Ok(sync::cached_issues(&state.store)?)
}
