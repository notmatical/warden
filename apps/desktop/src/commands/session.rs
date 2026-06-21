//! Session command wrappers: creation, transcript reads, the message/cancel
//! controls that drive agent turns, and live updates to a session's settings.
//! The logic lives in `warden_core::{store, git, agent, provider, event}`.

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::State;

use warden_core::agent::attachments::{self, Attachment};
use warden_core::event::emit_session;
use warden_core::git::{self, provision_working_dir, setup};
use warden_core::provider::{backend_for_model, opencode};
use warden_core::store::NewSession;
use warden_core::util::uuid;
use warden_core::{
    agent, Backend, ContextSource, EffortLevel, EventRecord, PermissionMode, Session,
    SessionContextSource, SessionKind, SessionRole,
};
use warden_core::{AppError, CommandResult};
use warden_core::{Label, ProjectLabels};

use crate::state::AppState;

/// Default reasoning effort for a new session.
const DEFAULT_EFFORT: EffortLevel = EffortLevel::High;

/// Ultracode is a Claude Code session setting; a session landing on another
/// backend (model switch, explicit choice) falls back to the next highest
/// tier instead of carrying a label its menu doesn't offer.
fn clamp_effort(backend: Backend, effort: EffortLevel) -> EffortLevel {
    if backend != Backend::Claude && effort == EffortLevel::Ultracode {
        EffortLevel::Max
    } else {
        effort
    }
}

#[tauri::command]
#[specta::specta]
pub async fn get_events(
    state: State<'_, AppState>,
    session_id: String,
) -> CommandResult<Vec<EventRecord>> {
    state.store.list_events(&session_id).map_err(Into::into)
}

/// Optional fields for `create_session`. Grouped into a struct so the command
/// stays within specta's 10-parameter limit while remaining fully expressive.
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionOptions {
    pub group_id: Option<String>,
    pub permission_mode: Option<String>,
    pub effort: Option<String>,
    pub role: Option<String>,
    pub kind: Option<String>,
    pub backend: Option<String>,
    pub isolate: Option<bool>,
    pub native_command: Option<String>,
    /// Run in this exact directory instead of provisioning one — e.g. a shell
    /// opened inside another session's worktree. Implies no isolation.
    pub working_dir: Option<String>,
    /// Linear issue this session works on; drives writeback on PR open/merge.
    pub linear_issue_id: Option<String>,
    /// Worktree branch name (e.g. `feature/WAR-123` derived from an issue).
    pub branch_hint: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn create_session(
    state: State<'_, AppState>,
    project_id: String,
    title: String,
    model: String,
    options: CreateSessionOptions,
) -> CommandResult<Session> {
    let project = state.store.get_project(&project_id)?;
    let group_id = match options.group_id {
        Some(id) => id,
        None => state
            .store
            .ensure_group_for_project(&project_id, &project.name)?,
    };
    let permission_mode = options
        .permission_mode
        .as_deref()
        .and_then(PermissionMode::parse)
        .unwrap_or(PermissionMode::BypassPermissions);
    let effort = options
        .effort
        .as_deref()
        .and_then(EffortLevel::parse)
        .unwrap_or(DEFAULT_EFFORT);
    let role = options
        .role
        .as_deref()
        .and_then(SessionRole::parse)
        .unwrap_or(SessionRole::Chat);
    let kind = options
        .kind
        .as_deref()
        .and_then(SessionKind::parse)
        .unwrap_or(SessionKind::Agent);

    // Worktree-first: agent sessions isolate by default. Plain terminals stay
    // in the checkout — a fresh worktree per shell is noise, not safety. An
    // explicit working_dir (a shell inside an existing worktree) wins outright.
    let dir = match options.working_dir.filter(|d| !d.trim().is_empty()) {
        Some(working_dir) => git::ProvisionedDir {
            working_dir,
            branch: None,
            base_sha: None,
            base_branch: None,
            is_isolated: false,
        },
        None => {
            let isolate = options.isolate.unwrap_or(kind != SessionKind::Terminal);
            provision_working_dir(&project, isolate, options.branch_hint.as_deref())?
        }
    };
    // An explicit backend wins; otherwise it follows from the model id, since
    // the model picks its own backend (codex/gpt ids run on Codex).
    let backend = options
        .backend
        .as_deref()
        .and_then(Backend::parse)
        .unwrap_or_else(|| backend_for_model(&model));
    let effort = clamp_effort(backend, effort);

    let session = state.store.create_session(NewSession {
        group_id,
        project_id,
        title,
        kind,
        backend,
        model,
        permission_mode,
        effort,
        role,
        auto_named: true,
        agent_session_id: uuid(),
        terminal_command: options.native_command,
        working_dir: dir.working_dir,
        branch: dir.branch,
        base_sha: dir.base_sha,
        base_branch: dir.base_branch,
        is_isolated: dir.is_isolated,
        parent_id: None,
        workflow_id: None,
        linear_issue_id: options.linear_issue_id,
    })?;

    emit_session(&session);
    setup::spawn_session_setup(&state.store, &session, &project.path);
    Ok(session)
}

/// Change a session's model, permission mode, and/or effort. Each field is
/// optional; omitted fields keep their current value. Applies to the next turn.
#[tauri::command]
#[specta::specta]
pub async fn update_session(
    state: State<'_, AppState>,
    session_id: String,
    model: Option<String>,
    permission_mode: Option<String>,
    effort: Option<String>,
) -> CommandResult<Session> {
    let session = state.store.get_session(&session_id)?;

    let model = model.unwrap_or(session.model);
    let backend = backend_for_model(&model);
    let permission_mode = permission_mode
        .as_deref()
        .and_then(PermissionMode::parse)
        .unwrap_or(session.permission_mode);
    let effort = effort
        .as_deref()
        .and_then(EffortLevel::parse)
        .unwrap_or(session.effort);
    let effort = clamp_effort(backend, effort);

    state
        .store
        .update_session_settings(&session_id, &model, backend, permission_mode, effort)?;

    let updated = state.store.get_session(&session_id)?;
    emit_session(&updated);
    Ok(updated)
}

/// Rename a session (its tab title).
#[tauri::command]
#[specta::specta]
pub async fn rename_session(
    state: State<'_, AppState>,
    session_id: String,
    title: String,
) -> CommandResult<Session> {
    state.store.rename_session(&session_id, title.trim())?;
    let updated = state.store.get_session(&session_id)?;
    emit_session(&updated);
    Ok(updated)
}

/// Pin/unpin a session — pinned sessions sort to the top of the folder list.
#[tauri::command]
#[specta::specta]
pub async fn set_session_pinned(
    state: State<'_, AppState>,
    session_id: String,
    pinned: bool,
) -> CommandResult<Session> {
    state.store.set_session_pinned(&session_id, pinned)?;
    let updated = state.store.get_session(&session_id)?;
    emit_session(&updated);
    Ok(updated)
}

/// A project's labels + which sessions each is attached to (one round-trip).
#[tauri::command]
#[specta::specta]
pub async fn load_project_labels(
    state: State<'_, AppState>,
    project_id: String,
) -> CommandResult<ProjectLabels> {
    Ok(state.store.project_labels(&project_id)?)
}

#[tauri::command]
#[specta::specta]
pub async fn create_label(
    state: State<'_, AppState>,
    project_id: String,
    name: String,
    color: String,
) -> CommandResult<Label> {
    Ok(state.store.create_label(&project_id, name.trim(), &color)?)
}

#[tauri::command]
#[specta::specta]
pub async fn update_label(
    state: State<'_, AppState>,
    id: String,
    name: String,
    color: String,
) -> CommandResult<()> {
    state.store.update_label(&id, name.trim(), &color)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_label(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    state.store.delete_label(&id)?;
    Ok(())
}

/// Replace a session's attached labels.
#[tauri::command]
#[specta::specta]
pub async fn set_session_labels(
    state: State<'_, AppState>,
    session_id: String,
    label_ids: Vec<String>,
) -> CommandResult<()> {
    state.store.set_session_labels(&session_id, &label_ids)?;
    Ok(())
}

/// What deleting a session would destroy, so the UI can ask before — instead of
/// force-deleting work. All zeros when nothing is at risk: checkout sessions
/// (nothing is removed), merged sessions (already cleaned), shared worktrees
/// (kept for the siblings).
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCheck {
    /// Files with uncommitted changes in the worktree (untracked included).
    pub dirty_files: u32,
    /// Commits on the session's branch its base doesn't have.
    pub unmerged_commits: u32,
    /// Other sessions running in the same worktree — it stays while they exist.
    pub shared_sessions: u32,
}

#[tauri::command]
#[specta::specta]
pub async fn session_delete_check(
    state: State<'_, AppState>,
    session_id: String,
) -> CommandResult<DeleteCheck> {
    let session = state.store.get_session(&session_id)?;
    let mut check = DeleteCheck {
        dirty_files: 0,
        unmerged_commits: 0,
        shared_sessions: 0,
    };
    if !session.is_isolated || session.merged_at.is_some() {
        return Ok(check);
    }
    check.shared_sessions = state
        .store
        .count_sessions_sharing_workdir(&session.working_dir, &session_id)
        .unwrap_or(0) as u32;
    // A shared worktree isn't removed, so nothing in it is at risk.
    if check.shared_sessions > 0 {
        return Ok(check);
    }
    let worktree = std::path::Path::new(&session.working_dir);
    if worktree.exists() {
        check.dirty_files = git::dirty_file_count(worktree);
        if let Some(base) = session.base_sha.as_deref() {
            check.unmerged_commits = git::unmerged_commit_count(worktree, base);
        }
    }
    Ok(check)
}

/// Permanently delete a session: stop its turn and PTY, tear down its isolated
/// worktree and branch (best-effort, in the background), and remove its rows
/// (events cascade). The worktree survives while sibling sessions share it, and
/// only paths under warden's own worktrees root are ever removed.
#[tauri::command]
#[specta::specta]
pub async fn delete_session(state: State<'_, AppState>, session_id: String) -> CommandResult<()> {
    let session = state.store.get_session(&session_id)?;
    state.manager.cancel(&state.store, &session_id);
    warden_core::terminal::kill(&session_id);

    if session.is_isolated && session.merged_at.is_none() {
        let shared = state
            .store
            .count_sessions_sharing_workdir(&session.working_dir, &session_id)
            .unwrap_or(0);
        let worktree = std::path::PathBuf::from(&session.working_dir);
        if shared == 0 {
            if let Ok(project) = state.store.get_project(&session.project_id) {
                let repo = std::path::Path::new(&project.path);
                if git::is_managed_worktree(repo, &worktree) {
                    // Background: teardown commands may take a while; deletion
                    // shouldn't. The branch goes too — the UI confirmed any
                    // unmerged work via session_delete_check.
                    setup::spawn_teardown_and_remove(
                        project.path.into(),
                        worktree,
                        session.branch.clone(),
                    );
                }
            }
        }
    }

    state.store.delete_session(&session_id)?;
    Ok(())
}

/// Re-run the repo's worktree setup commands for a session (after a failure,
/// or after the user edits the commands).
#[tauri::command]
#[specta::specta]
pub async fn retry_worktree_setup(
    state: State<'_, AppState>,
    session_id: String,
) -> CommandResult<()> {
    let session = state.store.get_session(&session_id)?;
    if !session.is_isolated {
        // Nothing to set up in the checkout — the failure being retried is a
        // leftover from a torn-down worktree, so retrying clears it.
        state.store.set_session_setup(&session_id, None, None)?;
        let updated = state.store.get_session(&session_id)?;
        emit_session(&updated);
        return Ok(());
    }
    let project = state.store.get_project(&session.project_id)?;
    setup::spawn_session_setup(&state.store, &session, &project.path);
    Ok(())
}

/// Clear a failed setup state so the session is usable as-is.
#[tauri::command]
#[specta::specta]
pub async fn dismiss_setup_error(
    state: State<'_, AppState>,
    session_id: String,
) -> CommandResult<()> {
    state.store.set_session_setup(&session_id, None, None)?;
    if let Ok(updated) = state.store.get_session(&session_id) {
        emit_session(&updated);
    }
    Ok(())
}

/// Toggle a session's git-worktree isolation. Only allowed before the first
/// turn — afterward the agent's conversation is tied to its working directory.
#[tauri::command]
#[specta::specta]
pub async fn set_session_isolation(
    state: State<'_, AppState>,
    session_id: String,
    isolate: bool,
) -> CommandResult<Session> {
    let session = state.store.get_session(&session_id)?;
    if session.turns != 0 {
        return Err(AppError::Invalid(
            "isolation can only change before the session's first turn".to_string(),
        )
        .into());
    }
    if session.is_isolated == isolate {
        return Ok(session);
    }

    let project = state.store.get_project(&session.project_id)?;

    // Tear down the existing worktree (and its unused branch) when turning
    // isolation off. The session has no turns yet, so nothing is lost.
    if session.is_isolated {
        setup::spawn_teardown_and_remove(
            project.path.clone().into(),
            session.working_dir.clone().into(),
            session.branch.clone(),
        );
    }

    let dir = provision_working_dir(&project, isolate, None)?;
    state.store.update_session_workdir(
        &session_id,
        &dir.working_dir,
        dir.branch.as_deref(),
        dir.base_sha.as_deref(),
        dir.base_branch.as_deref(),
        dir.is_isolated,
    )?;
    // Any setup state belonged to the torn-down worktree; re-isolating below
    // starts a fresh run.
    state.store.set_session_setup(&session_id, None, None)?;

    let updated = state.store.get_session(&session_id)?;
    emit_session(&updated);
    setup::spawn_session_setup(&state.store, &updated, &project.path);
    Ok(updated)
}

#[tauri::command]
#[specta::specta]
pub async fn send_message(
    state: State<'_, AppState>,
    session_id: String,
    text: String,
    attachments: Option<Vec<String>>,
) -> CommandResult<()> {
    let session = state.store.get_session(&session_id)?;

    // An OpenCode turn blocked on a question consumes the next message as the
    // answer (Claude's question flow ends the turn, so its reply is just the
    // next turn's prompt — this is the OpenCode equivalent).
    if session.backend == Backend::Opencode && opencode::agent::has_pending_question(&session_id) {
        return opencode::agent::answer_question(&state.store, &session_id, &text)
            .await
            .map_err(Into::into);
    }

    // A brand-new chat session gets a clean title generated from its first
    // message, in the background, unless the user has already named it. Title
    // off the user's own words, before attachment references are appended.
    let naming_ctx =
        (session.turns == 0 && session.auto_named && session.role == SessionRole::Chat)
            .then(|| (session.backend, session.working_dir.clone(), text.clone()));

    // Append a reference line per attachment so the agent reads it via its tools.
    let message = match attachments {
        Some(paths) if !paths.is_empty() => {
            let refs = paths
                .iter()
                .map(|p| attachments::reference_line(p))
                .collect::<Vec<_>>()
                .join("\n");
            format!("{text}\n\n{refs}")
        }
        _ => text,
    };

    state
        .manager
        .run_turn(state.store.clone(), session, message)
        .await?;

    if let Some((backend, working_dir, message)) = naming_ctx {
        let store = state.store.clone();
        tauri::async_runtime::spawn(async move {
            let Some(title) = agent::generate_session_title(backend, &working_dir, &message).await
            else {
                return;
            };
            match store.apply_auto_name(&session_id, &title) {
                Ok(true) => {
                    log::debug!("session naming: applied {title:?} to {session_id}");
                    if let Ok(updated) = store.get_session(&session_id) {
                        emit_session(&updated);
                    }
                }
                Ok(false) => {
                    log::debug!("session naming: {session_id} already user-named; skipped");
                }
                Err(e) => log::warn!("session naming: failed to apply title: {e}"),
            }
        });
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_session(state: State<'_, AppState>, session_id: String) -> CommandResult<()> {
    state.manager.cancel(&state.store, &session_id);
    Ok(())
}

/// Approve denied tool patterns for a session and resume the turn. For
/// OpenCode the turn is still alive, blocked on the ask — approving replies to
/// it server-side and the turn continues on its own.
#[tauri::command]
#[specta::specta]
pub async fn approve_tools(
    state: State<'_, AppState>,
    session_id: String,
    patterns: Vec<String>,
) -> CommandResult<()> {
    let session = state.store.get_session(&session_id)?;
    if session.backend == Backend::Opencode {
        opencode::agent::approve_pending_permission(&session_id).await;
        return Ok(());
    }
    state.store.add_allowed_tools(&session_id, &patterns)?;
    state
        .manager
        .resume(state.store.clone(), session)
        .await
        .map_err(Into::into)
}

/// Reject a pending tool ask. Only OpenCode has a live ask to answer — a
/// Claude denial already ended the turn, so dismissing is purely client-side
/// and never reaches here.
#[tauri::command]
#[specta::specta]
pub async fn reject_tools(state: State<'_, AppState>, session_id: String) -> CommandResult<()> {
    let session = state.store.get_session(&session_id)?;
    if session.backend == Backend::Opencode {
        opencode::agent::reject_pending_permission(&session_id).await;
    }
    Ok(())
}

/// Approve the agent's plan: leave `plan` mode for `acceptEdits` and resume so
/// the agent implements it. The persistent process is killed inside
/// `resume_with`, so it respawns with the new permission mode.
#[tauri::command]
#[specta::specta]
pub async fn approve_plan(state: State<'_, AppState>, session_id: String) -> CommandResult<()> {
    let session = state.store.get_session(&session_id)?;
    state.store.update_session_settings(
        &session_id,
        &session.model,
        session.backend,
        PermissionMode::AcceptEdits,
        session.effort,
    )?;
    let updated = state.store.get_session(&session_id)?;
    emit_session(&updated);
    state
        .manager
        .resume_with(
            state.store.clone(),
            updated,
            "The plan is approved. Please implement it now.".to_string(),
        )
        .await
        .map_err(Into::into)
}

/// Stage files dropped on the composer: copy any outside the working dir into
/// the session's attachments dir, returning records to reference on send.
#[tauri::command]
#[specta::specta]
pub async fn attach_to_session(
    state: State<'_, AppState>,
    session_id: String,
    paths: Vec<String>,
) -> CommandResult<Vec<Attachment>> {
    let session = state.store.get_session(&session_id)?;
    attachments::stage(&session_id, &session.working_dir, &paths).map_err(Into::into)
}

// ----- context sources -------------------------------------------------------

/// List a session's context sources (files, dirs, saved text), in order.
#[tauri::command]
#[specta::specta]
pub async fn list_context_sources(
    state: State<'_, AppState>,
    session_id: String,
) -> CommandResult<Vec<SessionContextSource>> {
    state
        .store
        .list_context_sources(&session_id)
        .map_err(Into::into)
}

/// Append a context source to a session and drop its warm process so the next
/// turn picks up the new context.
#[tauri::command]
#[specta::specta]
pub async fn add_context_source(
    state: State<'_, AppState>,
    session_id: String,
    source: ContextSource,
) -> CommandResult<SessionContextSource> {
    let record = state.store.add_context_source(&session_id, &source)?;
    agent::refresh_session(&session_id);
    Ok(record)
}

/// Remove a context source from a session.
#[tauri::command]
#[specta::specta]
pub async fn remove_context_source(
    state: State<'_, AppState>,
    session_id: String,
    id: String,
) -> CommandResult<()> {
    state.store.remove_context_source(&id)?;
    agent::refresh_session(&session_id);
    Ok(())
}

/// Enable or disable a context source without removing it.
#[tauri::command]
#[specta::specta]
pub async fn set_context_source_enabled(
    state: State<'_, AppState>,
    session_id: String,
    id: String,
    enabled: bool,
) -> CommandResult<()> {
    state.store.set_context_source_enabled(&id, enabled)?;
    agent::refresh_session(&session_id);
    Ok(())
}
