//! Focus-aware polling tiers (a reference app's pattern): remote pollers run hot while
//! the window is focused, slow down in the background, and crawl once the app
//! has been unattended for a while. The frontend reports focus transitions;
//! pollers read the tier each 1s tick and fire immediately on focus regain.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::State;

use crate::error::CommandResult;
use crate::state::AppState;

/// Frontend focus reporting: window focus/blur events land here.
#[tauri::command]
#[specta::specta]
pub async fn set_app_focus_state(state: State<'_, AppState>, focused: bool) -> CommandResult<()> {
    state.focus.set_focused(focused);
    Ok(())
}

/// Unfocused for longer than this counts as idle.
const IDLE_AFTER: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    Active,
    Background,
    Idle,
}

/// Current window focus plus when it last changed. `epoch` bumps on every
/// transition so pollers can edge-detect focus regain without subscribing.
pub struct FocusState {
    focused: AtomicBool,
    since: Mutex<Instant>,
    epoch: AtomicU64,
}

impl Default for FocusState {
    fn default() -> Self {
        Self {
            focused: AtomicBool::new(true),
            since: Mutex::new(Instant::now()),
            epoch: AtomicU64::new(0),
        }
    }
}

impl FocusState {
    pub fn set_focused(&self, focused: bool) {
        if self.focused.swap(focused, Ordering::Relaxed) == focused {
            return; // no transition
        }
        *self.since.lock().unwrap() = Instant::now();
        self.epoch.fetch_add(1, Ordering::Relaxed);
        log::debug!("window focus changed: focused={focused}");
    }

    pub fn focused(&self) -> bool {
        self.focused.load(Ordering::Relaxed)
    }

    pub fn epoch(&self) -> u64 {
        self.epoch.load(Ordering::Relaxed)
    }

    pub fn tier(&self) -> Tier {
        if self.focused() {
            return Tier::Active;
        }
        if self.since.lock().unwrap().elapsed() >= IDLE_AFTER {
            Tier::Idle
        } else {
            Tier::Background
        }
    }
}

/// A poller's per-tier cadence.
pub struct TierIntervals {
    pub active: Duration,
    pub background: Duration,
    pub idle: Duration,
}

impl TierIntervals {
    pub fn interval(&self, tier: Tier) -> Duration {
        match tier {
            Tier::Active => self.active,
            Tier::Background => self.background,
            Tier::Idle => self.idle,
        }
    }
}
