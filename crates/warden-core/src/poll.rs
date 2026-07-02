//! Focus-aware polling tiers (a reference app's pattern): remote pollers run hot while the
//! window is focused, slow down in the background, and crawl once the app has
//! been unattended for a while. The frontend reports focus transitions; the
//! shared driver reads the tier each 1s tick and fires immediately on focus
//! regain. `set_app_focus_state` (the `#[tauri::command]`) lives in the shell.

use std::future::Future;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Unfocused for longer than this counts as idle.
const IDLE_AFTER: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    Active,
    Background,
    Idle,
}

/// Current window focus plus when it last changed. `epoch` bumps on every
/// transition so the poll driver can edge-detect focus regain without
/// subscribing.
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

    /// Transition counter — an internal detail of [`run_focus_tiered_poll`].
    fn epoch(&self) -> u64 {
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

/// Drive a focus-tiered poll loop for the app's lifetime. `poll_immediately`
/// fires the first tick at once (Linear); otherwise the first tick waits one
/// full interval (GitHub — sessions/PRs aren't loaded at t=0). Focus regain
/// always polls immediately. The `tick` closure does one poll pass.
pub async fn run_focus_tiered_poll<F, Fut>(
    focus: Arc<FocusState>,
    intervals: TierIntervals,
    poll_immediately: bool,
    mut tick: F,
) where
    F: FnMut() -> Fut,
    Fut: Future<Output = ()>,
{
    let mut last_poll = if poll_immediately {
        None
    } else {
        Some(Instant::now())
    };
    let mut last_epoch = focus.epoch();
    loop {
        let tier = focus.tier();
        let epoch = focus.epoch();
        let regained = epoch != last_epoch && focus.focused();
        last_epoch = epoch;

        let due = !last_poll.is_some_and(|t| t.elapsed() < intervals.interval(tier));
        if due || regained {
            last_poll = Some(Instant::now());
            tick().await;
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}
