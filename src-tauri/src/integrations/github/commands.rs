//! Commands for managing the GitHub CLI: its status, installing/updating the
//! managed copy, choosing between managed and system PATH, and opening/refreshing
//! a session's pull request.

use std::path::Path;

use tauri::{AppHandle, State};

use crate::cli::{self, Source, Tool, ToolStatus};
use crate::domain::{Backend, EffortLevel, PermissionMode, Session, SessionKind, SessionRole};
use crate::error::{AppError, CommandResult};
use crate::events::emit_session;
use crate::integrations::github::issues::{self, GhIssue, GhIssueComment};
use crate::integrations::github::pr::{self, PrInfo};
use crate::state::AppState;
use crate::store::NewSession;
use crate::util::uuid;

#[tauri::command]
#[specta::specta]
pub async fn github_status() -> CommandResult<ToolStatus> {
    Ok(crate::integrations::github::status().await)
}

/// Install warden's managed copy of the GitHub CLI (latest version).
#[tauri::command]
#[specta::specta]
pub async fn install_github_cli(app: AppHandle) -> CommandResult<()> {
    cli::install(&app, Tool::Gh, None)
        .await
        .map_err(|e| AppError::Agent(e).into())
}

/// Reinstall the managed GitHub CLI at the latest published version.
#[tauri::command]
#[specta::specta]
pub async fn update_github_cli(app: AppHandle) -> CommandResult<()> {
    install_github_cli(app).await
}

/// Choose where the GitHub CLI comes from (`auto` | `managed` | `system`).
#[tauri::command]
#[specta::specta]
pub async fn set_github_source(state: State<'_, AppState>, source: String) -> CommandResult<()> {
    let source = Source::parse(&source)
        .ok_or_else(|| AppError::Invalid(format!("unknown CLI source: {source}")))?;
    state
        .store
        .set_setting(&Source::setting_key(Tool::Gh), source.as_str())?;
    cli::set_source(Tool::Gh, source);
    Ok(())
}

/// Commit the session's work, push its branch, and open a pull request against
/// the session's base branch.
#[tauri::command]
#[specta::specta]
pub async fn open_pull_request(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    title: String,
    body: String,
    draft: Option<bool>,
) -> CommandResult<PrInfo> {
    let session = state.store.get_session(&session_id)?;
    if session.merged_at.is_some() {
        return Err(AppError::Invalid("session is already merged".to_string()).into());
    }
    if !session.is_isolated {
        return Err(
            AppError::Invalid("only isolated worktree sessions can open a PR".to_string()).into(),
        );
    }
    let base = session
        .base_branch
        .clone()
        .ok_or_else(|| AppError::Invalid("session has no base branch".to_string()))?;

    let project = state.store.get_project(&session.project_id)?;
    let repo = Path::new(&project.path);
    let worktree = Path::new(&session.working_dir);
    if !crate::git::has_remote(repo) {
        return Err(
            AppError::Invalid("this repository has no git remote to push to".to_string()).into(),
        );
    }

    // Stop any in-flight work so the worktree isn't mutated mid-push.
    state.manager.cancel(&app, &state.store, &session_id);
    crate::terminal::kill(&session_id);

    let title = if title.trim().is_empty() {
        session.title.clone()
    } else {
        title
    };
    let _ = crate::git::stage_and_commit(worktree, &title)?;
    crate::git::push_branch(worktree)?;
    let info = pr::create_pr(worktree, &base, &title, &body, draft.unwrap_or(false))?;

    state.store.set_session_pr(
        &session_id,
        info.number,
        &info.url,
        &info.state,
        info.check_status,
    )?;
    if let Ok(updated) = state.store.get_session(&session_id) {
        emit_session(&app, &updated);
    }
    // Linear writeback: surface the PR on the originating issue (best-effort).
    if let Some(issue_id) = session.linear_issue_id.as_deref() {
        crate::integrations::linear::writeback::attach_pr(issue_id, &info.url).await;
    }
    Ok(info)
}

/// Re-read the session branch's pull request state from GitHub.
#[tauri::command]
#[specta::specta]
pub async fn refresh_pr_status(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> CommandResult<Option<PrInfo>> {
    let session = state.store.get_session(&session_id)?;
    let info = pr::status(Path::new(&session.working_dir))?;
    if let Some(ref info) = info {
        state.store.set_session_pr(
            &session_id,
            info.number,
            &info.url,
            &info.state,
            info.check_status,
        )?;
        if let Ok(updated) = state.store.get_session(&session_id) {
            emit_session(&app, &updated);
        }
    }
    Ok(info)
}

/// Open issues assigned to the user in one repo. Soft-fails to empty (no
/// remote / unauthenticated) so multi-repo aggregation degrades per repo.
#[tauri::command]
#[specta::specta]
pub async fn list_my_issues(
    state: State<'_, AppState>,
    project_id: String,
) -> CommandResult<Vec<GhIssue>> {
    let project = state.store.get_project(&project_id)?;
    Ok(issues::list_assigned_issues(Path::new(&project.path)))
}

/// Comments on one issue, fetched lazily for the detail view.
#[tauri::command]
#[specta::specta]
pub async fn github_issue_comments(
    state: State<'_, AppState>,
    project_id: String,
    number: i64,
) -> CommandResult<Vec<GhIssueComment>> {
    let project = state.store.get_project(&project_id)?;
    Ok(issues::issue_comments(Path::new(&project.path), number)?)
}

/// Rich state of the session's PR — review decision, diff stats, per-check CI
/// rows — fetched lazily when the user hovers the PR chip.
#[tauri::command]
#[specta::specta]
pub async fn pr_details(
    state: State<'_, AppState>,
    session_id: String,
) -> CommandResult<Option<pr::PrDetails>> {
    let session = state.store.get_session(&session_id)?;
    let number = session
        .pr_number
        .ok_or_else(|| AppError::Invalid("session has no pull request".to_string()))?;
    Ok(pr::details(Path::new(&session.working_dir), number)?)
}

/// Generate a suggested PR title and body from the session branch's changes,
/// for the user to review before opening. Falls back to the session title.
#[tauri::command]
#[specta::specta]
pub async fn generate_pr_content(
    state: State<'_, AppState>,
    session_id: String,
) -> CommandResult<crate::integrations::github::pr_content::PrContent> {
    let session = state.store.get_session(&session_id)?;
    let base = session
        .base_sha
        .clone()
        .ok_or_else(|| AppError::Invalid("session has no base commit".to_string()))?;
    crate::integrations::github::pr_content::generate_pr_content(
        session.backend,
        std::path::Path::new(&session.working_dir),
        &base,
        session.base_branch.as_deref(),
        &session.title,
    )
    .await
    .map_err(Into::into)
}

/// Open PRs in a project's repo, for the review-checkout picker.
#[tauri::command]
#[specta::specta]
pub async fn list_open_prs(
    state: State<'_, AppState>,
    project_id: String,
) -> CommandResult<Vec<pr::PrSummary>> {
    let project = state.store.get_project(&project_id)?;
    Ok(pr::list_prs(Path::new(&project.path)))
}

/// Check out an existing PR into a fresh isolated worktree and open a session on
/// it, for reviewing/running the PR locally.
#[tauri::command]
#[specta::specta]
pub async fn checkout_pr(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    number: i64,
    model: String,
) -> CommandResult<Session> {
    let project = state.store.get_project(&project_id)?;
    let repo = Path::new(&project.path);
    if !crate::git::has_remote(repo) {
        return Err(AppError::Invalid("this repository has no git remote".to_string()).into());
    }
    let base = pr::pr_base_ref(repo, number).unwrap_or_else(|| "main".to_string());
    let dir = crate::git::provision_pr_worktree(&project, number, &base)?;
    let group_id = state
        .store
        .ensure_group_for_project(&project_id, &project.name)?;

    let lower = model.to_ascii_lowercase();
    let backend = if lower.starts_with("gpt") || lower.starts_with("codex") {
        Backend::Codex
    } else {
        Backend::Claude
    };
    let working_dir = dir.working_dir.clone();
    let session = state.store.create_session(NewSession {
        group_id,
        project_id,
        title: format!("Review PR #{number}"),
        kind: SessionKind::Agent,
        backend,
        model,
        permission_mode: PermissionMode::BypassPermissions,
        effort: EffortLevel::High,
        role: SessionRole::Chat,
        auto_named: false,
        agent_session_id: uuid(),
        terminal_command: None,
        working_dir: dir.working_dir,
        branch: dir.branch,
        base_sha: dir.base_sha,
        base_branch: dir.base_branch,
        is_isolated: dir.is_isolated,
        parent_id: None,
        workflow_id: None,
        linear_issue_id: None,
    })?;

    // Light up the PR chip + merge controls for the reviewed PR.
    if let Ok(Some(info)) = pr::status(Path::new(&working_dir)) {
        let _ = state.store.set_session_pr(
            &session.id,
            info.number,
            &info.url,
            &info.state,
            info.check_status,
        );
    }
    let session = state.store.get_session(&session.id)?;
    emit_session(&app, &session);
    crate::git::setup::spawn_session_setup(&app, &state.store, &session, &project.path);
    Ok(session)
}
