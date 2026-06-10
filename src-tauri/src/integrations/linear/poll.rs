//! Background polling that keeps the cached Linear inbox fresh while the app is
//! open, emitting a change event only when the issue set actually changed.
//! Cadence is focus-tiered: hot while the window is focused, slow in the
//! background, crawling once the app sits unattended.

use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::core::poll_tier::TierIntervals;
use crate::events::emit_linear_changed;
use crate::state::AppState;

use super::{key, sync};

const INTERVALS: TierIntervals = TierIntervals {
    active: Duration::from_secs(10),
    background: Duration::from_secs(60),
    idle: Duration::from_secs(300),
};

/// Spawn the Linear poller for the app's lifetime. Polls immediately on
/// launch and again the moment the window regains focus.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let focus = app.state::<AppState>().focus.clone();
        let mut last_poll: Option<Instant> = None;
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

async fn poll_once(app: &AppHandle) {
    let Ok(Some(key)) = key::load() else {
        return; // not connected — nothing to sync
    };
    let store = app.state::<AppState>().store.clone();
    match sync::sync_once(&store, &key).await {
        Ok(true) => emit_linear_changed(app),
        Ok(false) => {}
        Err(e) => log::warn!("linear sync failed: {e}"),
    }
}
