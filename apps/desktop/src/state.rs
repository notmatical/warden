//! Shared application state managed by Tauri and injected into every command.
//! All domain logic lives in `warden-core`; this just holds the handles the
//! command wrappers thread into the core services.

use std::sync::Arc;

use warden_core::poll::FocusState;
use warden_core::workflow::WorkflowCancels;
use warden_core::{AgentManager, Store};

pub struct AppState {
    pub store: Store,
    pub manager: AgentManager,
    pub workflow_cancels: WorkflowCancels,
    /// Window focus, reported by the frontend; drives poll tiers.
    pub focus: Arc<FocusState>,
}
