//! The single run-level event the frontend listens on for live workflow
//! progress. Per-node transcripts come from each node's session via the
//! existing `session-updated`/`agent-event` channels.

use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Emitter};

use crate::domain::{WorkflowNodeRun, WorkflowRun};

pub const EVENT_WORKFLOW_RUN: &str = "workflow-run-updated";

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunView {
    pub run: WorkflowRun,
    pub nodes: Vec<WorkflowNodeRun>,
}

pub fn emit_workflow_run(app: &AppHandle, view: &WorkflowRunView) {
    let _ = app.emit(EVENT_WORKFLOW_RUN, view);
}
