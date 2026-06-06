//! Tauri commands for workflow CRUD and execution.

use tauri::{AppHandle, State};

use crate::domain::{NodeRunStatus, Workflow, WorkflowGraph, WorkflowNodeRun};
use crate::error::Result;
use crate::state::AppState;

use super::events::WorkflowRunView;
use super::executor::{self, RunContext};

#[tauri::command]
pub async fn create_workflow(
    state: State<'_, AppState>,
    project_id: String,
    name: String,
    graph: WorkflowGraph,
) -> Result<Workflow> {
    state.store.create_workflow(&project_id, &name, &graph)
}

#[tauri::command]
pub async fn get_workflow(state: State<'_, AppState>, id: String) -> Result<Workflow> {
    state.store.get_workflow(&id)
}

#[tauri::command]
pub async fn list_workflows(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<Workflow>> {
    state.store.list_workflows(&project_id)
}

#[tauri::command]
pub async fn update_workflow(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    graph: Option<WorkflowGraph>,
) -> Result<Workflow> {
    state
        .store
        .update_workflow(&id, name.as_deref(), graph.as_ref())
}

#[tauri::command]
pub async fn delete_workflow(state: State<'_, AppState>, id: String) -> Result<()> {
    state.store.delete_workflow(&id)
}

/// Snapshot the workflow's graph, seed its node runs, and spawn the executor.
#[tauri::command]
pub async fn run_workflow(
    app: AppHandle,
    state: State<'_, AppState>,
    workflow_id: String,
    group_id: Option<String>,
) -> Result<WorkflowRunView> {
    let wf = state.store.get_workflow(&workflow_id)?;
    let project = state.store.get_project(&wf.project_id)?;
    let group_id = match group_id {
        Some(g) => g,
        None => state
            .store
            .ensure_group_for_project(&wf.project_id, &project.name)?,
    };

    let run = state.store.create_workflow_run(
        Some(&workflow_id),
        &wf.project_id,
        &group_id,
        &wf.graph,
    )?;
    for node in &wf.graph.nodes {
        state.store.upsert_node_run(&WorkflowNodeRun {
            run_id: run.id.clone(),
            node_id: node.id.clone(),
            status: NodeRunStatus::Pending,
            session_id: None,
            output: None,
            error: None,
        })?;
    }

    let ctx = RunContext {
        app: app.clone(),
        store: state.store.clone(),
        manager: state.manager,
        run_id: run.id.clone(),
        project_id: wf.project_id.clone(),
        group_id,
        graph: wf.graph.clone(),
    };
    tauri::async_runtime::spawn(executor::drive(ctx));

    let nodes = state.store.list_node_runs(&run.id)?;
    Ok(WorkflowRunView { run, nodes })
}

#[tauri::command]
pub async fn get_workflow_run(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<WorkflowRunView> {
    let run = state.store.get_workflow_run(&run_id)?;
    let nodes = state.store.list_node_runs(&run_id)?;
    Ok(WorkflowRunView { run, nodes })
}

/// The workflow's most recent run (node statuses + sessions), or `None`.
#[tauri::command]
pub async fn get_latest_workflow_run(
    state: State<'_, AppState>,
    workflow_id: String,
) -> Result<Option<WorkflowRunView>> {
    match state.store.latest_workflow_run(&workflow_id)? {
        Some(run) => {
            let nodes = state.store.list_node_runs(&run.id)?;
            Ok(Some(WorkflowRunView { run, nodes }))
        }
        None => Ok(None),
    }
}
