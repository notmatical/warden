//! Workflow command wrappers for CRUD and execution. All logic lives in
//! `warden_core::workflow::service`.

use tauri::State;

use warden_core::workflow::service;
use warden_core::workflow::{Workflow, WorkflowGraph, WorkflowRun, WorkflowRunView};
use warden_core::{CommandResult, Session};

use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn create_workflow(
    state: State<'_, AppState>,
    project_id: String,
    name: String,
    graph: WorkflowGraph,
) -> CommandResult<Workflow> {
    service::create_workflow(&state.store, &project_id, &name, &graph).map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn get_workflow(state: State<'_, AppState>, id: String) -> CommandResult<Workflow> {
    service::get_workflow(&state.store, &id).map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn list_workflows(
    state: State<'_, AppState>,
    project_id: String,
) -> CommandResult<Vec<Workflow>> {
    service::list_workflows(&state.store, &project_id).map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn update_workflow(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    graph: Option<WorkflowGraph>,
) -> CommandResult<Workflow> {
    service::update_workflow(&state.store, &id, name.as_deref(), graph.as_ref()).map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn delete_workflow(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    service::delete_workflow(&state.store, &id).map_err(Into::into)
}

/// Snapshot the workflow's graph, seed its node runs, and spawn the executor.
#[tauri::command]
#[specta::specta]
pub async fn run_workflow(
    state: State<'_, AppState>,
    workflow_id: String,
    group_id: Option<String>,
) -> CommandResult<WorkflowRunView> {
    service::run_workflow(
        &state.store,
        &state.manager,
        &state.workflow_cancels,
        &workflow_id,
        group_id,
    )
    .await
    .map_err(Into::into)
}

/// The sessions a workflow's runs have spawned (for the sidebar).
#[tauri::command]
#[specta::specta]
pub async fn list_workflow_sessions(
    state: State<'_, AppState>,
    workflow_id: String,
) -> CommandResult<Vec<Session>> {
    service::list_workflow_sessions(&state.store, &workflow_id).map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn get_workflow_run(
    state: State<'_, AppState>,
    run_id: String,
) -> CommandResult<WorkflowRunView> {
    service::get_workflow_run(&state.store, &run_id).map_err(Into::into)
}

/// Resume a run paused at a gate: approve to continue past it, or reject to
/// cancel the run.
#[tauri::command]
#[specta::specta]
pub async fn resume_workflow(
    state: State<'_, AppState>,
    run_id: String,
    approve: bool,
) -> CommandResult<WorkflowRunView> {
    service::resume_workflow(
        &state.store,
        &state.manager,
        &state.workflow_cancels,
        &run_id,
        approve,
    )
    .map_err(Into::into)
}

/// Retry a failed or canceled run: every node that didn't finish resets to
/// pending, then the executor re-enters — `done` nodes are skipped, so the run
/// picks up where it stopped, in its original worktree.
#[tauri::command]
#[specta::specta]
pub async fn retry_workflow_run(
    state: State<'_, AppState>,
    run_id: String,
) -> CommandResult<WorkflowRunView> {
    service::retry_workflow_run(
        &state.store,
        &state.manager,
        &state.workflow_cancels,
        &run_id,
    )
    .map_err(Into::into)
}

/// A workflow's past runs, newest first (run history).
#[tauri::command]
#[specta::specta]
pub async fn list_workflow_runs(
    state: State<'_, AppState>,
    workflow_id: String,
    limit: Option<u32>,
) -> CommandResult<Vec<WorkflowRun>> {
    service::list_workflow_runs(&state.store, &workflow_id, limit.unwrap_or(20)).map_err(Into::into)
}

/// The workflow's most recent run (node statuses + sessions), or `None`.
#[tauri::command]
#[specta::specta]
pub async fn get_latest_workflow_run(
    state: State<'_, AppState>,
    workflow_id: String,
) -> CommandResult<Option<WorkflowRunView>> {
    service::get_latest_workflow_run(&state.store, &workflow_id).map_err(Into::into)
}

/// Cancel a workflow's latest run: signal the executor, stop the in-flight node
/// session, and settle the run to `Canceled`. No-op if there's no active run.
#[tauri::command]
#[specta::specta]
pub async fn cancel_workflow(
    state: State<'_, AppState>,
    workflow_id: String,
) -> CommandResult<Option<WorkflowRunView>> {
    service::cancel_workflow(
        &state.store,
        &state.manager,
        &state.workflow_cancels,
        &workflow_id,
    )
    .map_err(Into::into)
}
