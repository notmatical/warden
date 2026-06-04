//! Shared application state managed by Tauri and injected into every command.

use crate::agent::AgentManager;
use crate::store::Store;

pub struct AppState {
    pub store: Store,
    pub manager: AgentManager,
}
