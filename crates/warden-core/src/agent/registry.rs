//! A poison-tolerant in-flight map keyed by warden session id. The Codex and
//! OpenCode adapters each track which sessions have a turn (or pending ask) in
//! flight so a cancel can address it; this is the shared store for those maps,
//! replacing the hand-rolled `LazyLock<Mutex<HashMap<..>>>` + `unwrap_or_else`
//! boilerplate each adapter repeated.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

/// A `HashMap<String, H>` behind a poison-tolerant mutex. `H` is whatever the
/// adapter needs to address an in-flight turn (a thread/turn id pair, an HTTP
/// turn handle, a queue of pending asks). Construct one in a `LazyLock`.
pub struct TurnRegistry<H> {
    map: Mutex<HashMap<String, H>>,
}

impl<H> Default for TurnRegistry<H> {
    fn default() -> Self {
        Self::new()
    }
}

impl<H> TurnRegistry<H> {
    pub fn new() -> Self {
        Self {
            map: Mutex::new(HashMap::new()),
        }
    }

    /// Lock the map, recovering the guard if a prior holder panicked (the turn
    /// bookkeeping is independent per session, so recovery is safe).
    pub fn lock(&self) -> MutexGuard<'_, HashMap<String, H>> {
        self.map.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Insert (or replace) the handle for a session.
    pub fn insert(&self, session_id: &str, handle: H) {
        self.lock().insert(session_id.to_string(), handle);
    }

    /// Remove a session's handle, returning it if present.
    pub fn remove(&self, session_id: &str) -> Option<H> {
        self.lock().remove(session_id)
    }

    /// Whether a session currently has an entry.
    pub fn contains(&self, session_id: &str) -> bool {
        self.lock().contains_key(session_id)
    }
}

impl<H: Clone> TurnRegistry<H> {
    /// A clone of a session's handle, if present.
    pub fn get_cloned(&self, session_id: &str) -> Option<H> {
        self.lock().get(session_id).cloned()
    }
}
