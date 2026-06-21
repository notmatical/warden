//! GitHub command wrappers (CLI management, PRs, issues) plus the background
//! PR/CI poller. Logic lives in `warden_core::{integrations::github, cli, git}`.

use std::path::Path;

use tauri::State;

use warden_core::cli::{self, Source, Tool, ToolStatus};
use warden_core::event::emit_session;
use warden_core::integrations::github::issues::{self, GhIssue, GhIssueComment};
use warden_core::integrations::github::pr::{self, PrDetails, PrInfo, PrSummary};
use warden_core::integrations::github::pr_content::{
    generate_pr_content as gen_pr_content, PrContent,
};
use warden_core::integrations::{github, linear};
use warden_core::provider::backend_for_model;
use warden_core::store::NewSession;
use warden_core::util::uuid;
use warden_core::{
    git, AppError, CommandResult, EffortLevel, PermissionMode, Session, SessionKind, SessionRole,
};

use crate::state::AppState;

/// Map a `PrInfo` onto the store's decomposed `set_session_pr` (the store layer
/// is deliberately free of any github type).
fn persist_pr(
    store: &warden_core::Store,
    session_id: &str,
    info: &PrInfo,
) -> warden_core::error::Result<()> {
    store.set_session_pr(
        session_id,
        Some(info.number),
        Some(info.url.as_str()),
        Some(info.state.as_str()),
        info.check_status,
        info.is_draft,
        info.review_decision.as_deref(),
        info.check_counts.as_ref(),
    )
}

#[tauri::command]
#[specta::specta]
pub async fn github_status() -> CommandResult<ToolStatus> {
    Ok(github::status().await)
}

/// Install warden's managed copy of the GitHub CLI (latest version).
#[tauri::command]
#[specta::specta]
pub async fn install_github_cli() -> CommandResult<()> {
    cli::install(Tool::Gh, None).await.map_err(Into::into)
}

/// Reinstall the managed GitHub CLI at the latest published version.
#[tauri::command]
#[specta::specta]
pub async fn update_github_cli() -> CommandResult<()> {
    install_github_cli().await
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
    if !git::has_remote(repo) {
        return Err(
            AppError::Invalid("this repository has no git remote to push to".to_string()).into(),
        );
    }

    // Stop any in-flight work so the worktree isn't mutated mid-push.
    state.manager.cancel(&state.store, &session_id);
    warden_core::terminal::kill(&session_id);

    let title = if title.trim().is_empty() {
        session.title.clone()
    } else {
        title
    };
    let _ = git::stage_and_commit(worktree, &title)?;
    git::push_branch(worktree)?;
    let info = pr::create_pr(worktree, &base, &title, &body, draft.unwrap_or(false))?;

    persist_pr(&state.store, &session_id, &info)?;
    if let Ok(updated) = state.store.get_session(&session_id) {
        emit_session(&updated);
    }
    // Linear writeback: surface the PR on the originating issue (best-effort).
    if let Some(issue_id) = session.linear_issue_id.as_deref() {
        linear::writeback::attach_pr(issue_id, &info.url).await;
    }
    Ok(info)
}

/// Re-read the session branch's pull request state from GitHub.
#[tauri::command]
#[specta::specta]
pub async fn refresh_pr_status(
    state: State<'_, AppState>,
    session_id: String,
) -> CommandResult<Option<PrInfo>> {
    let session = state.store.get_session(&session_id)?;
    let info = pr::status(Path::new(&session.working_dir))?;
    if let Some(ref info) = info {
        persist_pr(&state.store, &session_id, info)?;
        if let Ok(updated) = state.store.get_session(&session_id) {
            emit_session(&updated);
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
) -> CommandResult<Option<PrDetails>> {
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
) -> CommandResult<PrContent> {
    let session = state.store.get_session(&session_id)?;
    let base = session
        .base_sha
        .clone()
        .ok_or_else(|| AppError::Invalid("session has no base commit".to_string()))?;
    gen_pr_content(
        session.backend,
        Path::new(&session.working_dir),
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
) -> CommandResult<Vec<PrSummary>> {
    let project = state.store.get_project(&project_id)?;
    Ok(pr::list_prs(Path::new(&project.path)))
}

/// Check out an existing PR into a fresh isolated worktree and open a session on
/// it, for reviewing/running the PR locally.
#[tauri::command]
#[specta::specta]
pub async fn checkout_pr(
    state: State<'_, AppState>,
    project_id: String,
    number: i64,
    model: String,
) -> CommandResult<Session> {
    let project = state.store.get_project(&project_id)?;
    let repo = Path::new(&project.path);
    if !git::has_remote(repo) {
        return Err(AppError::Invalid("this repository has no git remote".to_string()).into());
    }
    let base = pr::pr_base_ref(repo, number).unwrap_or_else(|| "main".to_string());
    let dir = git::provision_pr_worktree(&project, number, &base)?;
    let group_id = state
        .store
        .ensure_group_for_project(&project_id, &project.name)?;

    let backend = backend_for_model(&model);
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
        let _ = persist_pr(&state.store, &session.id, &info);
    }
    let session = state.store.get_session(&session.id)?;
    emit_session(&session);
    git::setup::spawn_session_setup(&state.store, &session, &project.path);
    Ok(session)
}

pub mod poll {
    //! Background polling that keeps each session's pull-request state and
    //! CI-check rollup fresh, emitting a session update only when something
    //! changed, and retiring a session when its PR merges. Cadence is
    //! focus-tiered (gentler than Linear's — each tick shells out to `gh`).

    use std::path::Path;
    use std::time::Duration;

    use tauri::{AppHandle, Manager};

    use warden_core::event::{emit_session, Notification, NotifyEvent, NotifyTarget};
    use warden_core::integrations::{github::pr, linear};
    use warden_core::poll::{run_focus_tiered_poll, TierIntervals};
    use warden_core::{event, git, Store};

    use crate::state::AppState;

    const INTERVALS: TierIntervals = TierIntervals {
        active: Duration::from_secs(30),
        background: Duration::from_secs(120),
        idle: Duration::from_secs(600),
    };

    /// Spawn the PR poller for the app's lifetime. The first poll waits one full
    /// interval (sessions/PRs aren't loaded at t=0); focus regain polls at once.
    pub fn spawn(app: AppHandle) {
        let state = app.state::<AppState>();
        let focus = state.focus.clone();
        let store = state.store.clone();
        let manager = state.manager;
        tauri::async_runtime::spawn(async move {
            run_focus_tiered_poll(focus, INTERVALS, false, || {
                let store = store.clone();
                async move { poll_once(&store, manager).await }
            })
            .await;
        });
    }

    /// Refresh every session that has an open PR. Synchronous `gh` calls run on
    /// the poll task; cheap enough at this cadence.
    async fn poll_once(store: &Store, manager: warden_core::AgentManager) {
        let Ok(sessions) = store.sessions_with_open_pr() else {
            return;
        };
        for session in sessions {
            let Ok(Some(info)) = pr::status(Path::new(&session.working_dir)) else {
                continue;
            };
            let changed = session.pr_state.as_deref() != Some(info.state.as_str())
                || session.pr_check_status != info.check_status
                || session.pr_check_counts != info.check_counts
                || session.pr_is_draft != info.is_draft
                || session.pr_review_decision != info.review_decision;
            let _ = super::persist_pr(store, &session.id, &info);

            // A PR that just merged retires its session: stop any in-flight
            // work, tear down the worktree + branch, and mark the session
            // read-only — exactly as if it had been landed in-app.
            if info.state.is_merged() && session.merged_at.is_none() && session.is_isolated {
                manager.cancel(store, &session.id);
                warden_core::terminal::kill(&session.id);
                let shared = store
                    .count_sessions_sharing_workdir(&session.working_dir, &session.id)
                    .unwrap_or(0);
                let worktree = std::path::PathBuf::from(&session.working_dir);
                if shared == 0 {
                    if let Ok(project) = store.get_project(&session.project_id) {
                        let repo = Path::new(&project.path);
                        if git::is_managed_worktree(repo, &worktree) {
                            git::setup::spawn_teardown_and_remove(
                                project.path.into(),
                                worktree,
                                session.branch.clone(),
                            );
                        }
                    }
                }
                let _ = store.mark_session_merged(&session.id);
                // Linear writeback: the work landed, so complete the issue
                // (best-effort) and refresh the cached issue list.
                if let Some(issue_id) = session.linear_issue_id.as_deref() {
                    if linear::writeback::on_pr_merged(store, issue_id).await {
                        event::emit_linear_changed();
                    }
                }
                event::emit_notification(&Notification {
                    title: format!("PR #{} merged", info.number),
                    body: Some(format!("{} was retired.", session.title)),
                    event: Some(NotifyEvent::PrChecks),
                    tone: None,
                    sound: None,
                    target: Some(NotifyTarget::Session {
                        id: session.id.clone(),
                    }),
                });
            }

            if changed {
                if let Ok(updated) = store.get_session(&session.id) {
                    emit_session(&updated);
                }
            }
        }
    }
}
