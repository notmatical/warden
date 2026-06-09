//! Background polling that keeps the cached Linear inbox fresh while the app is
//! open, emitting a change event only when the issue set actually changed.

use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::events::emit_linear_changed;
use crate::state::AppState;

use super::{key, sync};

const POLL_INTERVAL: Duration = Duration::from_secs(60);

/// Spawn the Linear poller for the app's lifetime. The first tick fires
/// immediately, doing an initial sync on launch when connected.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(POLL_INTERVAL);
        loop {
            ticker.tick().await;
            poll_once(&app).await;
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
