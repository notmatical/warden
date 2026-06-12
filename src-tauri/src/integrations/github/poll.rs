//! Background polling that keeps each session's pull-request state and CI-check
//! rollup fresh, emitting a session update only when something actually changed.
//! Cadence is focus-tiered, gentler than Linear's since each tick shells out to
//! `gh` once per open PR.

use std::path::Path;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::core::poll_tier::TierIntervals;
use crate::events::{emit_notification, emit_session, Notification, NotifyTarget};
use crate::state::AppState;

const INTERVALS: TierIntervals = TierIntervals {
    active: Duration::from_secs(30),
    background: Duration::from_secs(120),
    idle: Duration::from_secs(600),
};

/// Spawn the PR poller for the app's lifetime. The first poll waits one full
/// interval (sessions/PRs aren't loaded at t=0); focus regain polls at once.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let focus = app.state::<AppState>().focus.clone();
        let mut last_poll = Some(Instant::now());
        let mut last_epoch = focus.epoch();
        loop {
            let tier = focus.tier();
            let epoch = focus.epoch();
            let regained = epoch != last_epoch && focus.focused();
            last_epoch = epoch;

            let due = !last_poll.is_some_and(|t| t.elapsed() < INTERVALS.interval(tier));
            if due || regained {
                last_poll = Some(Instant::now());
                poll_once(&app).await;
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });
}

/// Refresh every session that has an open PR. Synchronous `gh` calls run on the
/// poll task; cheap enough at this cadence.
async fn poll_once(app: &AppHandle) {
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
            || session.pr_check_status != info.check_status
            || session.pr_check_counts != info.check_counts
            || session.pr_is_draft != info.is_draft
            || session.pr_review_decision != info.review_decision;
        let _ = store.set_session_pr(&session.id, &info);

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
            if shared == 0 {
                if let Ok(project) = store.get_project(&session.project_id) {
                    let repo = Path::new(&project.path);
                    if crate::git::is_managed_worktree(repo, &worktree) {
                        crate::git::setup::spawn_teardown_and_remove(
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
                crate::integrations::linear::writeback::complete_issue(issue_id).await;
                if let Ok(Some(key)) = crate::integrations::linear::key::load() {
                    if matches!(
                        crate::integrations::linear::sync::sync_once(&store, &key).await,
                        Ok(true)
                    ) {
                        crate::events::emit_linear_changed(app);
                    }
                }
            }
            emit_notification(
                app,
                &Notification {
                    title: format!("PR #{} merged", info.number),
                    body: Some(format!("{} was retired.", session.title)),
                    event: Some("prChecks".into()),
                    tone: None,
                    sound: None,
                    target: Some(NotifyTarget::Session {
                        id: session.id.clone(),
                    }),
                },
            );
        }

        if changed {
            if let Ok(updated) = store.get_session(&session.id) {
                emit_session(app, &updated);
            }
        }
    }
}
