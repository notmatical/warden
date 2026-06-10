//! Tauri commands for the Linear integration: connect (validate + store key),
//! disconnect, report connection status, read the cached inbox, and force a sync.

use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, State};

use crate::error::{AppError, CommandResult};
use crate::events::emit_linear_changed;
use crate::state::AppState;

use super::binding::{self, LinearBinding};
use super::client::{self, LinearComment, LinearIssue, LinearTeam, Viewer};
use super::{key, sync, writeback};

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

/// Move an issue to its team's primary "started" state (writeback on
/// send-to-agent). Freshens the cache afterwards so the inbox reflects it.
#[tauri::command]
#[specta::specta]
pub async fn linear_start_issue(
    app: AppHandle,
    state: State<'_, AppState>,
    issue_id: String,
    team_id: String,
) -> CommandResult<()> {
    let key = key::load()?.ok_or_else(|| AppError::Invalid("not connected to Linear".into()))?;
    writeback::start_issue(&key, &issue_id, &team_id).await?;
    if matches!(sync::sync_once(&state.store, &key).await, Ok(true)) {
        emit_linear_changed(&app);
    }
    Ok(())
}

/// Comments for one issue, fetched live when the peek panel opens. Not cached:
/// keeping comments out of the poll query keeps its complexity flat, and
/// fetching on open means they are never stale.
#[tauri::command]
#[specta::specta]
pub async fn linear_issue_comments(issue_id: String) -> CommandResult<Vec<LinearComment>> {
    let key = key::load()?.ok_or_else(|| AppError::Invalid("not connected to Linear".into()))?;
    Ok(client::fetch_issue_comments(&key, &issue_id).await?)
}

/// Force a sync against Linear and return the freshened cache.
#[tauri::command]
#[specta::specta]
pub async fn linear_sync_now(state: State<'_, AppState>) -> CommandResult<Vec<LinearIssue>> {
    let key = key::load()?.ok_or_else(|| AppError::Invalid("not connected to Linear".into()))?;
    sync::sync_once(&state.store, &key).await?;
    Ok(sync::cached_issues(&state.store)?)
}

/// Teams (with their projects) visible to the user — for the binding picker.
#[tauri::command]
#[specta::specta]
pub async fn linear_teams() -> CommandResult<Vec<LinearTeam>> {
    let key = key::load()?.ok_or_else(|| AppError::Invalid("not connected to Linear".into()))?;
    Ok(client::fetch_teams(&key).await?)
}

/// A project's Linear binding from its `.warden/config.json`, if any.
#[tauri::command]
#[specta::specta]
pub async fn linear_binding(
    state: State<'_, AppState>,
    project_id: String,
) -> CommandResult<Option<LinearBinding>> {
    let project = state.store.get_project(&project_id)?;
    Ok(binding::read(std::path::Path::new(&project.path)))
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLinearBinding {
    pub project_id: String,
    pub binding: LinearBinding,
}

/// Every known project that carries a Linear binding — for preselecting the
/// repo when sending an issue to an agent.
#[tauri::command]
#[specta::specta]
pub async fn linear_bindings(
    state: State<'_, AppState>,
) -> CommandResult<Vec<ProjectLinearBinding>> {
    let projects = state.store.list_projects()?;
    Ok(projects
        .into_iter()
        .filter_map(|p| {
            binding::read(std::path::Path::new(&p.path)).map(|b| ProjectLinearBinding {
                project_id: p.id,
                binding: b,
            })
        })
        .collect())
}

/// Write (or remove, with `None`) a project's Linear binding.
#[tauri::command]
#[specta::specta]
pub async fn linear_set_binding(
    state: State<'_, AppState>,
    project_id: String,
    binding: Option<LinearBinding>,
) -> CommandResult<()> {
    let project = state.store.get_project(&project_id)?;
    binding::write(std::path::Path::new(&project.path), binding.as_ref())?;
    Ok(())
}
