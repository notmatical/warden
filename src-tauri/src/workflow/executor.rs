//! Workflow run executor. For the vertical slice this runs nodes in topological
//! (linear) order; parallel branches, conditional edges, and human gates arrive
//! in later phases. Each AgentTask node maps to a session run to completion via
//! `AgentManager::run_node_to_completion`; edges inject the source node's output
//! as the target's context.

use std::collections::{HashMap, VecDeque};

use tauri::AppHandle;

use crate::agent::AgentManager;
use crate::domain::{
    Backend, ContextSource, NodeKind, NodeRunStatus, RunStatus, SessionKind, WorkflowGraph,
    WorkflowNodeRun,
};
use crate::error::{AppError, Result};
use crate::events::emit_session;
use crate::git::{provision_working_dir, ProvisionedDir};
use crate::store::{NewSession, Store};
use crate::util::uuid;

use super::events::{emit_workflow_run, WorkflowRunView};

pub struct RunContext {
    pub app: AppHandle,
    pub store: Store,
    pub manager: AgentManager,
    pub run_id: String,
    pub project_id: String,
    pub group_id: String,
    pub graph: WorkflowGraph,
}

/// Drive a workflow run to completion, settling its final status.
pub async fn drive(ctx: RunContext) {
    let outcome = run_linear(&ctx).await;
    let _ = match &outcome {
        Ok(()) => ctx
            .store
            .set_workflow_run_status(&ctx.run_id, RunStatus::Completed, None),
        Err(e) => {
            ctx.store
                .set_workflow_run_status(&ctx.run_id, RunStatus::Failed, Some(&e.to_string()))
        }
    };
    emit_run(&ctx);
}

async fn run_linear(ctx: &RunContext) -> Result<()> {
    ctx.store
        .set_workflow_run_status(&ctx.run_id, RunStatus::Running, None)?;
    emit_run(ctx);

    let order = topo_order(&ctx.graph)?;
    let project = ctx.store.get_project(&ctx.project_id)?;
    let mut coding_dir: Option<ProvisionedDir> = None;
    let mut node_session: HashMap<String, String> = HashMap::new();
    let mut last_session: Option<String> = None;

    for node_id in order {
        let Some(node) = ctx.graph.nodes.iter().find(|n| n.id == node_id) else {
            continue;
        };
        let cfg = match &node.kind {
            NodeKind::Start => continue,
            NodeKind::AgentTask(cfg) => cfg,
        };

        // Coding nodes share one worktree on the named branch; read-only nodes
        // reuse it, or run in the project checkout if none exists yet.
        let dir = if cfg.writes_code() {
            if coding_dir.is_none() {
                coding_dir = Some(provision_working_dir(
                    &ctx.app,
                    &project,
                    true,
                    cfg.branch_hint.as_deref(),
                )?);
            }
            coding_dir.clone().unwrap()
        } else if let Some(d) = &coding_dir {
            d.clone()
        } else {
            provision_working_dir(&ctx.app, &project, false, None)?
        };

        let parent_id = ctx
            .graph
            .edges
            .iter()
            .filter(|e| e.target == node_id)
            .find_map(|e| node_session.get(&e.source).cloned())
            .or_else(|| last_session.clone());

        let title = if node.label.is_empty() {
            "Workflow node".to_string()
        } else {
            node.label.clone()
        };
        let session = ctx.store.create_session(NewSession {
            group_id: ctx.group_id.clone(),
            project_id: ctx.project_id.clone(),
            title,
            kind: SessionKind::Agent,
            backend: Backend::for_model(&cfg.model),
            model: cfg.model.clone(),
            permission_mode: cfg.permission_mode,
            effort: cfg.effort,
            role: cfg.role,
            auto_named: false,
            agent_session_id: uuid(),
            terminal_command: None,
            working_dir: dir.working_dir.clone(),
            branch: dir.branch.clone(),
            base_sha: dir.base_sha.clone(),
            base_branch: dir.base_branch.clone(),
            is_isolated: dir.is_isolated,
            parent_id,
        })?;
        emit_session(&ctx.app, &session);

        // Inbound edges → inject each source node's output as context.
        for edge in ctx.graph.edges.iter().filter(|e| e.target == node_id) {
            if let Some(src_session) = node_session.get(&edge.source) {
                let label = ctx
                    .graph
                    .nodes
                    .iter()
                    .find(|n| n.id == edge.source)
                    .map(|n| {
                        let name = if n.label.is_empty() {
                            "upstream node"
                        } else {
                            n.label.as_str()
                        };
                        format!("Output from {name}")
                    });
                ctx.store.add_context_source(
                    &session.id,
                    &ContextSource::NodeOutput {
                        session_id: src_session.clone(),
                        label,
                    },
                )?;
            }
        }

        node_session.insert(node_id.clone(), session.id.clone());
        last_session = Some(session.id.clone());
        set_node(
            ctx,
            &node_id,
            NodeRunStatus::Running,
            Some(&session.id),
            None,
            None,
        )?;

        match ctx
            .manager
            .run_node_to_completion(&ctx.app, &ctx.store, &session, &cfg.prompt)
            .await
        {
            Ok(output) => {
                set_node(
                    ctx,
                    &node_id,
                    NodeRunStatus::Done,
                    Some(&session.id),
                    Some(&output),
                    None,
                )?;
            }
            Err(e) => {
                set_node(
                    ctx,
                    &node_id,
                    NodeRunStatus::Failed,
                    Some(&session.id),
                    None,
                    Some(&e.to_string()),
                )?;
                return Err(e);
            }
        }
    }
    Ok(())
}

fn set_node(
    ctx: &RunContext,
    node_id: &str,
    status: NodeRunStatus,
    session_id: Option<&str>,
    output: Option<&str>,
    error: Option<&str>,
) -> Result<()> {
    ctx.store.upsert_node_run(&WorkflowNodeRun {
        run_id: ctx.run_id.clone(),
        node_id: node_id.to_string(),
        status,
        session_id: session_id.map(str::to_string),
        output: output.map(str::to_string),
        error: error.map(str::to_string),
    })?;
    emit_run(ctx);
    Ok(())
}

fn emit_run(ctx: &RunContext) {
    if let (Ok(run), Ok(nodes)) = (
        ctx.store.get_workflow_run(&ctx.run_id),
        ctx.store.list_node_runs(&ctx.run_id),
    ) {
        emit_workflow_run(&ctx.app, &WorkflowRunView { run, nodes });
    }
}

/// Topological order of node ids (Kahn). Errors on a cycle — loops arrive later.
fn topo_order(graph: &WorkflowGraph) -> Result<Vec<String>> {
    let mut indeg: HashMap<&str, usize> = graph.nodes.iter().map(|n| (n.id.as_str(), 0)).collect();
    let mut adj: HashMap<&str, Vec<&str>> = HashMap::new();
    for e in &graph.edges {
        if indeg.contains_key(e.source.as_str()) && indeg.contains_key(e.target.as_str()) {
            *indeg.get_mut(e.target.as_str()).unwrap() += 1;
            adj.entry(e.source.as_str())
                .or_default()
                .push(e.target.as_str());
        }
    }
    let mut queue: VecDeque<&str> = indeg
        .iter()
        .filter(|(_, &d)| d == 0)
        .map(|(&n, _)| n)
        .collect();
    let mut order = Vec::new();
    while let Some(n) = queue.pop_front() {
        order.push(n.to_string());
        if let Some(succ) = adj.get(n) {
            for &s in succ {
                let d = indeg.get_mut(s).unwrap();
                *d -= 1;
                if *d == 0 {
                    queue.push_back(s);
                }
            }
        }
    }
    if order.len() != graph.nodes.len() {
        return Err(AppError::Invalid(
            "workflow graph has a cycle (loops not yet supported)".to_string(),
        ));
    }
    Ok(order)
}
