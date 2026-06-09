//! Tauri commands for the Linear integration: connect (validate + store key),
//! disconnect, report connection status, and list the viewer's issues.

use serde::Serialize;
use specta::Type;

use crate::error::{AppError, CommandResult};

use super::client::{self, LinearIssue, Viewer};
use super::key;

/// Connection state for the Tasks UI.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LinearStatus {
    pub connected: bool,
}

/// Validate a personal API key against Linear and, on success, store it in the
/// OS keychain. Returns the authenticated user for the UI to display.
#[tauri::command]
#[specta::specta]
pub async fn linear_connect(key: String) -> CommandResult<Viewer> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err(AppError::Invalid("Linear API key is empty".into()).into());
    }
    let viewer = client::fetch_viewer(&key).await?;
    key::store(&key)?;
    Ok(viewer)
}

/// Forget the stored API key.
#[tauri::command]
#[specta::specta]
pub async fn linear_disconnect() -> CommandResult<()> {
    key::clear()?;
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

/// Issues assigned to the authenticated user.
#[tauri::command]
#[specta::specta]
pub async fn linear_list_issues() -> CommandResult<Vec<LinearIssue>> {
    let key = key::load()?.ok_or_else(|| AppError::Invalid("not connected to Linear".into()))?;
    let issues = client::fetch_assigned_issues(&key).await?;
    Ok(issues)
}
