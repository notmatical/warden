//! Session commands: creation, transcript/diff reads, and the message/cancel
//! controls that drive agent turns.

use tauri::{AppHandle, State};

use crate::domain::{Backend, EventRecord, PermissionMode, Session, SessionRole};
use crate::error::Result;
use crate::git::{self, DiffResult};
use crate::provision::provision_working_dir;
use crate::state::AppState;
use crate::store::NewSession;
use crate::util::uuid;
use crate::events::emit_session;

#[tauri::command]
pub async fn get_events(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<EventRecord>> {
    state.store.list_events(&session_id)
}

#[tauri::command]
pub async fn get_diff(state: State<'_, AppState>, session_id: String) -> Result<DiffResult> {
    let session = state.store.get_session(&session_id)?;
    git::compute_diff(
        std::path::Path::new(&session.working_dir),
        session.base_sha.as_deref(),
    )
}

#[tauri::command]
pub async fn create_session(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    title: String,
    model: String,
    permission_mode: Option<String>,
    role: Option<String>,
) -> Result<Session> {
    let workspace = state.store.get_workspace(&workspace_id)?;
    let dir = provision_working_dir(&app, &workspace)?;

    let permission_mode = permission_mode
        .as_deref()
        .and_then(PermissionMode::parse)
        .unwrap_or(PermissionMode::BypassPermissions);
    let role = role
        .as_deref()
        .and_then(SessionRole::parse)
        .unwrap_or(SessionRole::Chat);

    let session = state.store.create_session(NewSession {
        workspace_id,
        title,
        backend: Backend::Claude,
        model,
        permission_mode,
        role,
        agent_session_id: uuid(),
        working_dir: dir.working_dir,
        branch: dir.branch,
        base_sha: dir.base_sha,
        is_isolated: dir.is_isolated,
        parent_id: None,
    })?;

    emit_session(&app, &session);
    Ok(session)
}

#[tauri::command]
pub async fn send_message(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    text: String,
) -> Result<()> {
    let session = state.store.get_session(&session_id)?;
    state
        .manager
        .run_turn(app, state.store.clone(), session, text)
}

#[tauri::command]
pub async fn cancel_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<()> {
    state.manager.cancel(&app, &state.store, &session_id);
    Ok(())
}
