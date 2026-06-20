//! The single run-level event the frontend listens on for live workflow
//! progress. Per-node transcripts come from each node's session via the
//! existing `session-updated`/`agent-event` channels.
//!
//! [`WorkflowRunView`] lives here, not in `event/`, so the event tier stays
//! below `workflow` in the dependency graph. The emit helper pushes through the
//! global [`crate::event::state`] sink — no `AppHandle`.

use serde::Serialize;
use specta::Type;

use crate::workflow::{WorkflowNodeRun, WorkflowRun};

pub const EVENT_WORKFLOW_RUN: &str = "workflow-run-updated";

/// A run plus its per-node state — the DTO pushed to the UI on every change.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunView {
    pub run: WorkflowRun,
    pub nodes: Vec<WorkflowNodeRun>,
}

/// Emit a run update over the global event sink. A no-op without the `tauri`
/// feature, like every other emit helper.
pub fn emit_workflow_run(view: &WorkflowRunView) {
    #[cfg(feature = "tauri")]
    if let Some(app) = crate::event::state::app() {
        use tauri::Emitter;
        let _ = app.emit(EVENT_WORKFLOW_RUN, view);
    }
    #[cfg(not(feature = "tauri"))]
    let _ = view;
}
