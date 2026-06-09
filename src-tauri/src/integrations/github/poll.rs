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
    let store = app.state::<AppState>().store.clone();
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
        if changed {
            if let Ok(updated) = store.get_session(&session.id) {
                emit_session(app, &updated);
            }
        }
    }
}
