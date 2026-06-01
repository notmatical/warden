//! Session commands: creation, transcript reads, the message/cancel controls
//! that drive agent turns, and live updates to a session's agent settings.

use tauri::{AppHandle, State};

use crate::domain::{
    Backend, EffortLevel, EventRecord, PermissionMode, Session, SessionKind, SessionRole,
};
use crate::error::{AppError, Result};
use crate::git;
use crate::provision::provision_working_dir;
use crate::state::AppState;
use crate::store::NewSession;
use crate::util::uuid;
use crate::events::emit_session;

/// Default reasoning effort for a new session.
const DEFAULT_EFFORT: EffortLevel = EffortLevel::High;

#[tauri::command]
pub async fn get_events(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<EventRecord>> {
    state.store.list_events(&session_id)
}

#[tauri::command]
pub async fn create_session(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    title: String,
    model: String,
    permission_mode: Option<String>,
    effort: Option<String>,
    role: Option<String>,
    kind: Option<String>,
    isolate: Option<bool>,
) -> Result<Session> {
    let project = state.store.get_project(&project_id)?;
    let dir = provision_working_dir(&app, &project, isolate.unwrap_or(false))?;

    let permission_mode = permission_mode
        .as_deref()
        .and_then(PermissionMode::parse)
        .unwrap_or(PermissionMode::BypassPermissions);
    let effort = effort
        .as_deref()
        .and_then(EffortLevel::parse)
        .unwrap_or(DEFAULT_EFFORT);
    let role = role
        .as_deref()
        .and_then(SessionRole::parse)
        .unwrap_or(SessionRole::Chat);
    let kind = kind
        .as_deref()
        .and_then(SessionKind::parse)
        .unwrap_or(SessionKind::Agent);

    let session = state.store.create_session(NewSession {
        project_id,
        title,
        kind,
        backend: Backend::Claude,
        model,
        permission_mode,
        effort,
        role,
        auto_named: true,
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

/// Change a session's model, permission mode, and/or effort. Each field is
/// optional; omitted fields keep their current value. Applies to the next turn.
#[tauri::command]
pub async fn update_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    model: Option<String>,
    permission_mode: Option<String>,
    effort: Option<String>,
) -> Result<Session> {
    let session = state.store.get_session(&session_id)?;

    let model = model.unwrap_or(session.model);
    let permission_mode = permission_mode
        .as_deref()
        .and_then(PermissionMode::parse)
        .unwrap_or(session.permission_mode);
    let effort = effort
        .as_deref()
        .and_then(EffortLevel::parse)
        .unwrap_or(session.effort);

    state
        .store
        .update_session_settings(&session_id, &model, permission_mode, effort)?;

    let updated = state.store.get_session(&session_id)?;
    emit_session(&app, &updated);
    Ok(updated)
}

/// Rename a session (its tab title).
#[tauri::command]
pub async fn rename_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    title: String,
) -> Result<Session> {
    state.store.rename_session(&session_id, title.trim())?;
    let updated = state.store.get_session(&session_id)?;
    emit_session(&app, &updated);
    Ok(updated)
}

/// Permanently delete a session: stop any running turn, tear down its isolated
/// worktree (best-effort), and remove its rows (events cascade).
#[tauri::command]
pub async fn delete_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<()> {
    let session = state.store.get_session(&session_id)?;
    state.manager.cancel(&app, &state.store, &session_id);

    if session.is_isolated {
        if let Ok(project) = state.store.get_project(&session.project_id) {
            let repo = std::path::Path::new(&project.path);
            let worktree = std::path::Path::new(&session.working_dir);
            if let Err(e) = git::remove_worktree(repo, worktree) {
                log::warn!("failed to remove worktree for session {session_id}: {e}");
            }
        }
    }

    state.store.delete_session(&session_id)?;
    Ok(())
}

/// Toggle a session's git-worktree isolation. Only allowed before the first
/// turn — afterward the agent's conversation is tied to its working directory.
#[tauri::command]
pub async fn set_session_isolation(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    isolate: bool,
) -> Result<Session> {
    let session = state.store.get_session(&session_id)?;
    if session.turns != 0 {
        return Err(AppError::Invalid(
            "isolation can only change before the session's first turn".to_string(),
        ));
    }
    if session.is_isolated == isolate {
        return Ok(session);
    }

    let project = state.store.get_project(&session.project_id)?;

    // Tear down the existing worktree when turning isolation off.
    if session.is_isolated {
        let repo = std::path::Path::new(&project.path);
        let worktree = std::path::Path::new(&session.working_dir);
        if let Err(e) = git::remove_worktree(repo, worktree) {
            log::warn!("failed to remove worktree for {session_id}: {e}");
        }
    }

    let dir = provision_working_dir(&app, &project, isolate)?;
    state.store.update_session_workdir(
        &session_id,
        &dir.working_dir,
        dir.branch.as_deref(),
        dir.base_sha.as_deref(),
        dir.is_isolated,
    )?;

    let updated = state.store.get_session(&session_id)?;
    emit_session(&app, &updated);
    Ok(updated)
}

#[tauri::command]
pub async fn send_message(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    text: String,
) -> Result<()> {
    let session = state.store.get_session(&session_id)?;

    // A brand-new chat session gets a clean title generated from its first
    // message, in the background, unless the user has already named it.
    let naming_ctx = (session.turns == 0
        && session.auto_named
        && session.role == SessionRole::Chat)
        .then(|| (session.working_dir.clone(), text.clone()));

    state
        .manager
        .run_turn(app.clone(), state.store.clone(), session, text)?;

    if let Some((working_dir, message)) = naming_ctx {
        let store = state.store.clone();
        tauri::async_runtime::spawn(async move {
            let Some(title) = crate::agent::generate_session_title(&working_dir, &message).await
            else {
                return;
            };
            if matches!(store.apply_auto_name(&session_id, &title), Ok(true)) {
                if let Ok(updated) = store.get_session(&session_id) {
                    emit_session(&app, &updated);
                }
            }
        });
    }

    Ok(())
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
