//! De-Tauri'd workflow CRUD plus the `run`/`resume`/`retry`/`cancel` bodies.
//! These take `&Store` / `&AgentManager` / `&WorkflowCancels` and are what the
//! thin shell's `commands/workflow.rs` wrappers call. Emits go through the
//! global event sink — no `AppHandle`.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use crate::agent::AgentManager;
use crate::error::{AppError, Result};
use crate::store::Store;
use crate::workflow::{
    NodeKind, NodeRunStatus, RunStatus, Workflow, WorkflowGraph, WorkflowNodeRun, WorkflowRun,
};

use super::events::{emit_workflow_run, WorkflowRunView};
use super::executor::{self, RunContext, DEFAULT_MAX_PARALLEL};

/// Run ids with a pending cancel request. The executor checks this between
/// nodes and while waiting on a node, then settles the run to `Canceled`. The
/// shell's `AppState` holds one and passes it into the service functions.
pub type WorkflowCancels = Arc<Mutex<HashSet<String>>>;

/// A fresh, empty cancel registry — for the shell to seed its `AppState`.
pub fn new_cancels() -> WorkflowCancels {
    Arc::new(Mutex::new(HashSet::new()))
}

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

/// Reject starting/retrying a run when the workflow already has a live one — a
/// second would race it in the same worktree. Deduped guard for `run`/`retry`.
fn ensure_no_active_run(store: &Store, workflow_id: &str) -> Result<()> {
    if let Some(prev) = store.latest_workflow_run(workflow_id)? {
        if matches!(prev.status, RunStatus::Running | RunStatus::Paused) {
            return Err(AppError::Invalid(
                "workflow already has an active run; stop it first".to_string(),
            ));
        }
    }
    Ok(())
}

// ----- CRUD ----------------------------------------------------------------

pub fn create_workflow(
    store: &Store,
    project_id: &str,
    name: &str,
    graph: &WorkflowGraph,
) -> Result<Workflow> {
    store.create_workflow(project_id, name, graph)
}

pub fn get_workflow(store: &Store, id: &str) -> Result<Workflow> {
    store.get_workflow(id)
}

pub fn list_workflows(store: &Store, project_id: &str) -> Result<Vec<Workflow>> {
    store.list_workflows(project_id)
}

pub fn update_workflow(
    store: &Store,
    id: &str,
    name: Option<&str>,
    graph: Option<&WorkflowGraph>,
) -> Result<Workflow> {
    store.update_workflow(id, name, graph)
}

pub fn delete_workflow(store: &Store, id: &str) -> Result<()> {
    store.delete_workflow(id)
}

/// The sessions a workflow's runs have spawned (for the sidebar).
pub fn list_workflow_sessions(
    store: &Store,
    workflow_id: &str,
) -> Result<Vec<crate::session::Session>> {
    store.list_workflow_sessions(workflow_id)
}

pub fn get_workflow_run(store: &Store, run_id: &str) -> Result<WorkflowRunView> {
    let run = store.get_workflow_run(run_id)?;
    let nodes = store.list_node_runs(run_id)?;
    Ok(WorkflowRunView { run, nodes })
}

/// A workflow's past runs, newest first (run history).
pub fn list_workflow_runs(
    store: &Store,
    workflow_id: &str,
    limit: u32,
) -> Result<Vec<WorkflowRun>> {
    store.list_workflow_runs(workflow_id, limit)
}

/// The workflow's most recent run (node statuses + sessions), or `None`.
pub fn get_latest_workflow_run(
    store: &Store,
    workflow_id: &str,
) -> Result<Option<WorkflowRunView>> {
    match store.latest_workflow_run(workflow_id)? {
        Some(run) => {
            let nodes = store.list_node_runs(&run.id)?;
            Ok(Some(WorkflowRunView { run, nodes }))
        }
        None => Ok(None),
    }
}

// ----- execution -----------------------------------------------------------

/// Snapshot the workflow's graph, seed its node runs, and spawn the executor.
pub async fn run_workflow(
    store: &Store,
    manager: &AgentManager,
    cancels: &WorkflowCancels,
    workflow_id: &str,
    group_id: Option<String>,
) -> Result<WorkflowRunView> {
    let wf = store.get_workflow(workflow_id)?;
    if !wf
        .graph
        .nodes
        .iter()
        .any(|n| matches!(n.kind, NodeKind::AgentTask(_)))
    {
        return Err(AppError::Invalid(
            "workflow has no agent nodes to run".to_string(),
        ));
    }
    // One active run per workflow; a second would race it in the same worktree.
    ensure_no_active_run(store, workflow_id)?;

    let project = store.get_project(&wf.project_id)?;
    let group_id = match group_id {
        Some(g) => g,
        None => store.ensure_group_for_project(&wf.project_id, &project.name)?,
    };

    let run = store.create_workflow_run(Some(workflow_id), &wf.project_id, &group_id, &wf.graph)?;
    for node in &wf.graph.nodes {
        store.upsert_node_run(&WorkflowNodeRun {
            run_id: run.id.clone(),
            node_id: node.id.clone(),
            status: NodeRunStatus::Pending,
            session_id: None,
            output: None,
            error: None,
        })?;
    }

    let branch = run_branch(&wf.name, &run.id);
    spawn_run(RunContext {
        store: store.clone(),
        manager: *manager,
        run_id: run.id.clone(),
        project_id: wf.project_id.clone(),
        group_id,
        graph: wf.graph.clone(),
        branch,
        workflow_id: Some(workflow_id.to_string()),
        cancel: cancels.clone(),
        max_parallel: DEFAULT_MAX_PARALLEL,
    });

    let nodes = store.list_node_runs(&run.id)?;
    Ok(WorkflowRunView { run, nodes })
}

/// Resume a run paused at a gate: approve to continue past it, or reject to
/// cancel the run.
pub fn resume_workflow(
    store: &Store,
    manager: &AgentManager,
    cancels: &WorkflowCancels,
    run_id: &str,
    approve: bool,
) -> Result<WorkflowRunView> {
    let nodes = store.list_node_runs(run_id)?;
    let Some(paused) = nodes.iter().find(|n| n.status == NodeRunStatus::Paused) else {
        let run = store.get_workflow_run(run_id)?;
        return Ok(WorkflowRunView { run, nodes });
    };
    let gate_id = paused.node_id.clone();

    if !approve {
        store.upsert_node_run(&WorkflowNodeRun {
            run_id: run_id.to_string(),
            node_id: gate_id,
            status: NodeRunStatus::Failed,
            session_id: None,
            output: None,
            error: Some("Rejected at gate".to_string()),
        })?;
        store.set_workflow_run_status(run_id, RunStatus::Canceled, Some("rejected at gate"))?;
    } else {
        // Approve the gate, then re-enter the executor (it skips done nodes).
        store.upsert_node_run(&WorkflowNodeRun {
            run_id: run_id.to_string(),
            node_id: gate_id,
            status: NodeRunStatus::Done,
            session_id: None,
            output: None,
            error: None,
        })?;
        let run = store.get_workflow_run(run_id)?;
        respawn_run(store, manager, cancels, &run)?;
    }

    let run = store.get_workflow_run(run_id)?;
    let nodes = store.list_node_runs(run_id)?;
    Ok(WorkflowRunView { run, nodes })
}

/// Retry a failed or canceled run: every node that didn't finish resets to
/// pending, then the executor re-enters — `done` nodes are skipped, so the run
/// picks up where it stopped, in its original worktree.
pub fn retry_workflow_run(
    store: &Store,
    manager: &AgentManager,
    cancels: &WorkflowCancels,
    run_id: &str,
) -> Result<WorkflowRunView> {
    let run = store.get_workflow_run(run_id)?;
    if !matches!(run.status, RunStatus::Failed | RunStatus::Canceled) {
        return Err(AppError::Invalid(
            "only a failed or canceled run can be retried".to_string(),
        ));
    }
    // Same one-active-run rule as `run_workflow`.
    if let Some(wf_id) = run.workflow_id.as_deref() {
        ensure_no_active_run(store, wf_id)?;
    }
    for n in store.list_node_runs(run_id)? {
        if n.status != NodeRunStatus::Done {
            // Keep `session_id`: the worktree is rediscovered through it.
            store.upsert_node_run(&WorkflowNodeRun {
                status: NodeRunStatus::Pending,
                output: None,
                error: None,
                ..n
            })?;
        }
    }
    store.set_workflow_run_status(run_id, RunStatus::Pending, None)?;
    respawn_run(store, manager, cancels, &run)?;

    let run = store.get_workflow_run(run_id)?;
    let nodes = store.list_node_runs(run_id)?;
    Ok(WorkflowRunView { run, nodes })
}

/// Cancel a workflow's latest run: signal the executor, stop the in-flight node
/// session, and settle the run to `Canceled`. No-op if there's no active run.
pub fn cancel_workflow(
    store: &Store,
    manager: &AgentManager,
    cancels: &WorkflowCancels,
    workflow_id: &str,
) -> Result<Option<WorkflowRunView>> {
    let Some(run) = store.latest_workflow_run(workflow_id)? else {
        return Ok(None);
    };
    if matches!(run.status, RunStatus::Running | RunStatus::Paused) {
        if let Ok(mut set) = cancels.lock() {
            set.insert(run.id.clone());
        }
        // Kill the live node session(s) so their CLI process stops immediately;
        // the executor then settles the run to Canceled on its next check.
        // Settle the unfinished nodes too — a gate at `paused` or a node at
        // `running` would otherwise sit in that state forever.
        for n in store.list_node_runs(&run.id)? {
            if matches!(
                n.status,
                NodeRunStatus::Running | NodeRunStatus::AwaitingInput | NodeRunStatus::Paused
            ) {
                if let Some(sid) = &n.session_id {
                    manager.cancel(store, sid);
                }
                store.upsert_node_run(&WorkflowNodeRun {
                    status: NodeRunStatus::Skipped,
                    ..n
                })?;
            }
        }
        store.set_workflow_run_status(&run.id, RunStatus::Canceled, None)?;
    }
    let run = store.get_workflow_run(&run.id)?;
    let nodes = store.list_node_runs(&run.id)?;
    let view = WorkflowRunView { run, nodes };
    emit_workflow_run(&view);
    Ok(Some(view))
}

/// Spawn the executor for a `RunContext` on the async runtime.
fn spawn_run(ctx: RunContext) {
    tokio::spawn(executor::drive(ctx));
}

/// Re-enter the executor for an existing run (resume past a gate, or retry).
/// The walk skips `done` nodes, so finished work is preserved.
fn respawn_run(
    store: &Store,
    manager: &AgentManager,
    cancels: &WorkflowCancels,
    run: &WorkflowRun,
) -> Result<()> {
    let graph = store.get_workflow_run_graph(&run.id)?;
    // The branch only matters when no node has provisioned the worktree yet;
    // otherwise the executor reuses the existing one.
    let branch = match run
        .workflow_id
        .as_deref()
        .and_then(|id| store.get_workflow(id).ok())
    {
        Some(wf) => run_branch(&wf.name, &run.id),
        None => run_branch("workflow", &run.id),
    };
    spawn_run(RunContext {
        store: store.clone(),
        manager: *manager,
        run_id: run.id.clone(),
        project_id: run.project_id.clone(),
        group_id: run.group_id.clone(),
        graph,
        branch,
        workflow_id: run.workflow_id.clone(),
        cancel: cancels.clone(),
        max_parallel: DEFAULT_MAX_PARALLEL,
    });
    Ok(())
}

// ----- plan → code recipe --------------------------------------------------
//
// TODO(revise later): fold this into the workflow graph engine — a built-in
// "plan → code" graph (a Plan AgentTask edged to a Code AgentTask) run through
// `run_workflow`, instead of a bespoke two-session orchestration. Left as a
// standalone service fn for now; only the Tauri coupling is removed here. See
// docs/MONOREPO-MIGRATION.md.

pub use super::recipes::{run_plan_to_code, PlanToCodeResult};
