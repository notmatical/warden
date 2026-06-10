//! Background polling that keeps each session's pull-request state and CI-check
//! rollup fresh, emitting a session update only when something actually changed.
//! Cadence is focus-tiered, gentler than Linear's since each tick shells out to
//! `gh` once per open PR.

use std::path::Path;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::core::poll_tier::TierIntervals;
use crate::events::emit_session;
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
                poll_once(&app);
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });
}

/// Refresh every session that has an open PR. Synchronous `gh` calls run on the
/// poll task; cheap enough at this cadence.
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
