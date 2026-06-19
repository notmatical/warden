//! Tauri commands for workflow CRUD and execution.

use tauri::{AppHandle, State};

use crate::domain::{
    NodeKind, NodeRunStatus, RunStatus, Workflow, WorkflowGraph, WorkflowNodeRun, WorkflowRun,
};
use crate::error::{AppError, CommandResult};
use crate::state::AppState;

use super::events::WorkflowRunView;
use super::executor::{self, RunContext};

/// One branch per run: `wf/<workflow-slug>-<run-short>`. Shared by run and
/// resume so a gate-first resume provisions the same branch a fresh run would.
fn run_branch(workflow_name: &str, run_id: &str) -> String {
    let slug: String = workflow_name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let slug = slug.trim_matches('-');
    format!(
        "wf/{}-{}",
        if slug.is_empty() { "workflow" } else { slug },
        &run_id[..8.min(run_id.len())]
    )
}

#[tauri::command]
#[specta::specta]
pub async fn create_workflow(
    state: State<'_, AppState>,
    project_id: String,
    name: String,
    graph: WorkflowGraph,
) -> CommandResult<Workflow> {
    state
        .store
        .create_workflow(&project_id, &name, &graph)
        .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn get_workflow(state: State<'_, AppState>, id: String) -> CommandResult<Workflow> {
    state.store.get_workflow(&id).map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn list_workflows(
    state: State<'_, AppState>,
    project_id: String,
) -> CommandResult<Vec<Workflow>> {
    state.store.list_workflows(&project_id).map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn update_workflow(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    graph: Option<WorkflowGraph>,
) -> CommandResult<Workflow> {
    state
        .store
        .update_workflow(&id, name.as_deref(), graph.as_ref())
        .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn delete_workflow(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    state.store.delete_workflow(&id).map_err(Into::into)
}

/// Snapshot the workflow's graph, seed its node runs, and spawn the executor.
#[tauri::command]
#[specta::specta]
pub async fn run_workflow(
    app: AppHandle,
    state: State<'_, AppState>,
    workflow_id: String,
    group_id: Option<String>,
) -> CommandResult<WorkflowRunView> {
    let wf = state.store.get_workflow(&workflow_id)?;
    if !wf
        .graph
        .nodes
        .iter()
        .any(|n| matches!(n.kind, NodeKind::AgentTask(_)))
    {
        return Err(AppError::Invalid("workflow has no agent nodes to run".to_string()).into());
    }
    // One active run per workflow; a second would race it in the same worktree.
    if let Some(prev) = state.store.latest_workflow_run(&workflow_id)? {
        if matches!(prev.status, RunStatus::Running | RunStatus::Paused) {
            return Err(AppError::Invalid(
                "workflow already has an active run; stop it first".to_string(),
            )
            .into());
        }
    }
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

    let branch = run_branch(&wf.name, &run.id);

    let ctx = RunContext {
        app: app.clone(),
        store: state.store.clone(),
        manager: state.manager,
        run_id: run.id.clone(),
        project_id: wf.project_id.clone(),
        group_id,
        graph: wf.graph.clone(),
        branch,
        workflow_id: Some(workflow_id.clone()),
        cancel: state.workflow_cancels.clone(),
    };
    tauri::async_runtime::spawn(executor::drive(ctx));

    let nodes = state.store.list_node_runs(&run.id)?;
    Ok(WorkflowRunView { run, nodes })
}

/// The sessions a workflow's runs have spawned (for the sidebar).
#[tauri::command]
#[specta::specta]
pub async fn list_workflow_sessions(
    state: State<'_, AppState>,
    workflow_id: String,
) -> CommandResult<Vec<crate::domain::Session>> {
    state
        .store
        .list_workflow_sessions(&workflow_id)
        .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn get_workflow_run(
    state: State<'_, AppState>,
    run_id: String,
) -> CommandResult<WorkflowRunView> {
    let run = state.store.get_workflow_run(&run_id)?;
    let nodes = state.store.list_node_runs(&run_id)?;
    Ok(WorkflowRunView { run, nodes })
}

/// Resume a run paused at a gate: approve to continue past it, or reject to
/// cancel the run.
#[tauri::command]
#[specta::specta]
pub async fn resume_workflow(
    app: AppHandle,
    state: State<'_, AppState>,
    run_id: String,
    approve: bool,
) -> CommandResult<WorkflowRunView> {
    let nodes = state.store.list_node_runs(&run_id)?;
    let Some(paused) = nodes.iter().find(|n| n.status == NodeRunStatus::Paused) else {
        let run = state.store.get_workflow_run(&run_id)?;
        return Ok(WorkflowRunView { run, nodes });
    };
    let gate_id = paused.node_id.clone();

    if !approve {
        state.store.upsert_node_run(&WorkflowNodeRun {
            run_id: run_id.clone(),
            node_id: gate_id,
            status: NodeRunStatus::Failed,
            session_id: None,
            output: None,
            error: Some("Rejected at gate".to_string()),
        })?;
        state.store.set_workflow_run_status(
            &run_id,
            RunStatus::Canceled,
            Some("rejected at gate"),
        )?;
    } else {
        // Approve the gate, then re-enter the executor (it skips done nodes).
        state.store.upsert_node_run(&WorkflowNodeRun {
            run_id: run_id.clone(),
            node_id: gate_id,
            status: NodeRunStatus::Done,
            session_id: None,
            output: None,
            error: None,
        })?;
        let run = state.store.get_workflow_run(&run_id)?;
        respawn_run(&app, &state, &run)?;
    }

    let run = state.store.get_workflow_run(&run_id)?;
    let nodes = state.store.list_node_runs(&run_id)?;
    Ok(WorkflowRunView { run, nodes })
}

/// Re-enter the executor for an existing run (resume past a gate, or retry).
/// The walk skips `done` nodes, so finished work is preserved.
fn respawn_run(
    app: &AppHandle,
    state: &State<'_, AppState>,
    run: &WorkflowRun,
) -> CommandResult<()> {
    let graph = state.store.get_workflow_run_graph(&run.id)?;
    // The branch only matters when no node has provisioned the worktree yet;
    // otherwise the executor reuses the existing one.
    let branch = match run
        .workflow_id
        .as_deref()
        .and_then(|id| state.store.get_workflow(id).ok())
    {
        Some(wf) => run_branch(&wf.name, &run.id),
        None => run_branch("workflow", &run.id),
    };
    let ctx = RunContext {
        app: app.clone(),
        store: state.store.clone(),
        manager: state.manager,
        run_id: run.id.clone(),
        project_id: run.project_id.clone(),
        group_id: run.group_id.clone(),
        graph,
        branch,
        workflow_id: run.workflow_id.clone(),
        cancel: state.workflow_cancels.clone(),
    };
    tauri::async_runtime::spawn(executor::drive(ctx));
    Ok(())
}

/// Retry a failed or canceled run: every node that didn't finish resets to
/// pending, then the executor re-enters — `done` nodes are skipped, so the run
/// picks up where it stopped, in its original worktree.
#[tauri::command]
#[specta::specta]
pub async fn retry_workflow_run(
    app: AppHandle,
    state: State<'_, AppState>,
    run_id: String,
) -> CommandResult<WorkflowRunView> {
    let run = state.store.get_workflow_run(&run_id)?;
    if !matches!(run.status, RunStatus::Failed | RunStatus::Canceled) {
        return Err(
            AppError::Invalid("only a failed or canceled run can be retried".to_string()).into(),
        );
    }
    // Same one-active-run rule as `run_workflow`.
    if let Some(wf_id) = run.workflow_id.as_deref() {
        if let Some(latest) = state.store.latest_workflow_run(wf_id)? {
            if matches!(latest.status, RunStatus::Running | RunStatus::Paused) {
                return Err(AppError::Invalid(
                    "workflow already has an active run; stop it first".to_string(),
                )
                .into());
            }
        }
    }
    for n in state.store.list_node_runs(&run_id)? {
        if n.status != NodeRunStatus::Done {
            // Keep `session_id`: the worktree is rediscovered through it.
            state.store.upsert_node_run(&WorkflowNodeRun {
                status: NodeRunStatus::Pending,
                output: None,
                error: None,
                ..n
            })?;
        }
    }
    state
        .store
        .set_workflow_run_status(&run_id, RunStatus::Pending, None)?;
    respawn_run(&app, &state, &run)?;

    let run = state.store.get_workflow_run(&run_id)?;
    let nodes = state.store.list_node_runs(&run_id)?;
    Ok(WorkflowRunView { run, nodes })
}

/// A workflow's past runs, newest first (run history).
#[tauri::command]
#[specta::specta]
pub async fn list_workflow_runs(
    state: State<'_, AppState>,
    workflow_id: String,
    limit: Option<u32>,
) -> CommandResult<Vec<WorkflowRun>> {
    state
        .store
        .list_workflow_runs(&workflow_id, limit.unwrap_or(20))
        .map_err(Into::into)
}

/// The workflow's most recent run (node statuses + sessions), or `None`.
#[tauri::command]
#[specta::specta]
pub async fn get_latest_workflow_run(
    state: State<'_, AppState>,
    workflow_id: String,
) -> CommandResult<Option<WorkflowRunView>> {
    match state.store.latest_workflow_run(&workflow_id)? {
        Some(run) => {
            let nodes = state.store.list_node_runs(&run.id)?;
            Ok(Some(WorkflowRunView { run, nodes }))
        }
        None => Ok(None),
    }
}

/// Cancel a workflow's latest run: signal the executor, stop the in-flight node
/// session, and settle the run to `Canceled`. No-op if there's no active run.
#[tauri::command]
#[specta::specta]
pub async fn cancel_workflow(
    app: AppHandle,
    state: State<'_, AppState>,
    workflow_id: String,
) -> CommandResult<Option<WorkflowRunView>> {
    let Some(run) = state.store.latest_workflow_run(&workflow_id)? else {
        return Ok(None);
    };
    if matches!(run.status, RunStatus::Running | RunStatus::Paused) {
        if let Ok(mut set) = state.workflow_cancels.lock() {
            set.insert(run.id.clone());
        }
        // Kill the live node session(s) so their CLI process stops immediately;
        // the executor then settles the run to Canceled on its next check.
        // Settle the unfinished nodes too — a gate at `paused` or a node at
        // `running` would otherwise sit in that state forever.
        for n in state.store.list_node_runs(&run.id)? {
            if matches!(
                n.status,
                NodeRunStatus::Running | NodeRunStatus::AwaitingInput | NodeRunStatus::Paused
            ) {
                if let Some(sid) = &n.session_id {
                    state.manager.cancel(&app, &state.store, sid);
                }
                state.store.upsert_node_run(&WorkflowNodeRun {
                    status: NodeRunStatus::Skipped,
                    ..n
                })?;
            }
        }
        state
            .store
            .set_workflow_run_status(&run.id, RunStatus::Canceled, None)?;
    }
    let run = state.store.get_workflow_run(&run.id)?;
    let nodes = state.store.list_node_runs(&run.id)?;
    let view = WorkflowRunView { run, nodes };
    super::events::emit_workflow_run(&app, &view);
    Ok(Some(view))
}
