//! Shared application state managed by Tauri and injected into every command.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use crate::agent::AgentManager;
use crate::store::Store;

/// Run ids with a pending cancel request. The executor checks this between nodes
/// and while waiting on a node, then settles the run to `Canceled`.
pub type WorkflowCancels = Arc<Mutex<HashSet<String>>>;

pub struct AppState {
    pub store: Store,
    pub manager: AgentManager,
    pub workflow_cancels: WorkflowCancels,
}
