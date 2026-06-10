//! Background polling that keeps each session's pull-request state and CI-check
//! rollup fresh, emitting a session update only when something actually changed.

use std::path::Path;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::events::emit_session;
use crate::state::AppState;

/// How often to re-poll open PRs. Fixed for now (no settings surface yet).
const POLL_INTERVAL: Duration = Duration::from_secs(60);

/// Spawn the PR poller for the app's lifetime.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(POLL_INTERVAL);
        // Skip the immediate first tick; sessions/PRs aren't loaded at t=0.
        ticker.tick().await;
        loop {
            ticker.tick().await;
            poll_once(&app);
        }
    });
}

/// Refresh every session that has an open PR. Synchronous `gh` calls run on the
/// poll task; cheap enough at a 60s cadence.
fn poll_once(app: &AppHandle) {
    let state = app.state::<AppState>();
    let store = state.store.clone();
    let Ok(sessions) = store.sessions_with_open_pr() else {
        return;
    };
    for session in sessions {
        let Ok(Some(info)) = super::pr::status(Path::new(&session.working_dir)) else {
            continue;
        };
        let changed = session.pr_state.as_deref() != Some(info.state.as_str())
            || session.pr_check_status != info.check_status;
        let _ = store.set_session_pr(
            &session.id,
            info.number,
            &info.url,
            &info.state,
            info.check_status,
        );

        // A PR that just merged retires its session: stop any in-flight work,
        // tear down the worktree + branch, and mark the session read-only —
        // exactly as if it had been landed in-app.
        if info.state == "MERGED" && session.merged_at.is_none() && session.is_isolated {
            state.manager.cancel(app, &store, &session.id);
            crate::terminal::kill(&session.id);
            let shared = store
                .count_sessions_sharing_workdir(&session.working_dir, &session.id)
                .unwrap_or(0);
            let worktree = std::path::PathBuf::from(&session.working_dir);
            if shared == 0 && crate::git::is_managed_worktree(app, &worktree) {
                if let Ok(project) = store.get_project(&session.project_id) {
                    crate::git::setup::spawn_teardown_and_remove(
                        project.path.into(),
                        worktree,
                        session.branch.clone(),
                    );
                }
            }
            let _ = store.mark_session_merged(&session.id);
        }

        if changed {
            if let Ok(updated) = store.get_session(&session.id) {
                emit_session(app, &updated);
            }
        }
    }
}
