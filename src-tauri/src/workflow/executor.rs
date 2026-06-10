//! Workflow run executor. Runs nodes in topological (linear) order, sharing one
//! per-run worktree. Each AgentTask node's behavior comes from its `intent`
//! (the prompt template, mode, and whether it gets the diff); edges inject the
//! upstream node's output as context. A Gate node pauses the run. The walk skips
//! already-`done` nodes, so it doubles as the resume path.

use std::collections::{HashMap, VecDeque};
use std::path::Path;

use tauri::AppHandle;

use crate::agent::AgentManager;
use crate::domain::{
    ContextSource, NodeKind, NodeRunStatus, RunStatus, SessionKind, SessionStatus, WorkflowGraph,
    WorkflowNodeRun,
};
use crate::error::{AppError, Result};
use crate::events::emit_session;
use crate::git::{self, provision_working_dir, ProvisionedDir};
use crate::state::WorkflowCancels;
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
    /// Branch for this run's worktree (used on first provision).
    pub branch: String,
    /// The workflow this run belongs to (tags node sessions for the sidebar).
    pub workflow_id: Option<String>,
    /// Shared set of run ids with a pending cancel request.
    pub cancel: WorkflowCancels,
}

enum Outcome {
    Completed,
    Paused,
    Canceled,
}

/// Whether this run has a pending cancel request.
fn canceled(ctx: &RunContext) -> bool {
    ctx.cancel
        .lock()
        .map(|s| s.contains(&ctx.run_id))
        .unwrap_or(false)
}

/// Drive a run to completion or a gate, settling its status.
pub async fn drive(ctx: RunContext) {
    match run_steps(&ctx).await {
        Ok(Outcome::Completed) => {
            let _ = ctx
                .store
                .set_workflow_run_status(&ctx.run_id, RunStatus::Completed, None);
        }
        // Paused status is set inside run_steps; leave it.
        Ok(Outcome::Paused) => {}
        Ok(Outcome::Canceled) => {
            let _ = ctx
                .store
                .set_workflow_run_status(&ctx.run_id, RunStatus::Canceled, None);
        }
        Err(e) => {
            let _ = ctx.store.set_workflow_run_status(
                &ctx.run_id,
                RunStatus::Failed,
                Some(&e.to_string()),
            );
        }
    }
    // Drop the cancel flag for this run, however it ended.
    if let Ok(mut set) = ctx.cancel.lock() {
        set.remove(&ctx.run_id);
    }
    emit_run(&ctx);
}

async fn run_steps(ctx: &RunContext) -> Result<Outcome> {
    ctx.store
        .set_workflow_run_status(&ctx.run_id, RunStatus::Running, None)?;
    emit_run(ctx);

    let order = topo_order(&ctx.graph)?;
    let project = ctx.store.get_project(&ctx.project_id)?;

    // Existing per-node state lets a resumed run skip what already ran.
    let existing: HashMap<String, WorkflowNodeRun> = ctx
        .store
        .list_node_runs(&ctx.run_id)?
        .into_iter()
        .map(|n| (n.node_id.clone(), n))
        .collect();
    let mut node_session: HashMap<String, String> = existing
        .iter()
        .filter_map(|(id, n)| n.session_id.clone().map(|s| (id.clone(), s)))
        .collect();

    // One worktree per run, shared by every node. Reuse the existing one on a
    // resume (read from a prior node's session); otherwise provision it.
    let dir = match node_session.values().next() {
        Some(sid) => {
            let s = ctx.store.get_session(sid)?;
            ProvisionedDir {
                working_dir: s.working_dir,
                branch: s.branch,
                base_sha: s.base_sha,
                base_branch: s.base_branch,
                is_isolated: s.is_isolated,
            }
        }
        None => {
            let dir = provision_working_dir(&ctx.app, &project, true, Some(&ctx.branch))?;
            // Run repo setup before the first node so agents find a ready tree.
            if dir.is_isolated {
                if let Err(reason) =
                    git::setup::run_setup(Path::new(&project.path), Path::new(&dir.working_dir))
                        .await
                {
                    log::warn!("workflow worktree setup failed (continuing): {reason}");
                }
            }
            dir
        }
    };

    let mut last_session: Option<String> = None;

    for node_id in order {
        if canceled(ctx) {
            return Ok(Outcome::Canceled);
        }
        let already_done = existing
            .get(&node_id)
            .map(|n| matches!(n.status, NodeRunStatus::Done | NodeRunStatus::Skipped))
            .unwrap_or(false);
        if already_done {
            last_session = node_session.get(&node_id).cloned().or(last_session);
            continue;
        }

        let Some(node) = ctx.graph.nodes.iter().find(|n| n.id == node_id) else {
            continue;
        };

        let cfg = match &node.kind {
            NodeKind::Start => continue,
            NodeKind::Gate => {
                // Pause the run for human approval; resume re-enters here.
                ctx.store
                    .set_workflow_run_status(&ctx.run_id, RunStatus::Paused, None)?;
                set_node(ctx, &node_id, NodeRunStatus::Paused, None, None, None)?;
                return Ok(Outcome::Paused);
            }
            NodeKind::AgentTask(cfg) => cfg,
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
            backend: crate::domain::Backend::for_model(&cfg.model),
            model: cfg.model.clone(),
            permission_mode: cfg.effective_mode(),
            effort: cfg.effort,
            role: cfg.intent.role(),
            auto_named: false,
            agent_session_id: uuid(),
            terminal_command: None,
            working_dir: dir.working_dir.clone(),
            branch: dir.branch.clone(),
            base_sha: dir.base_sha.clone(),
            base_branch: dir.base_branch.clone(),
            is_isolated: dir.is_isolated,
            parent_id,
            workflow_id: ctx.workflow_id.clone(),
            linear_issue_id: None,
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

        // Review/Revise nodes also get the worktree diff as context.
        if cfg.intent.needs_diff() {
            if let Some(base) = &dir.base_sha {
                let diff = git::worktree_diff(Path::new(&dir.working_dir), base);
                if !diff.trim().is_empty() {
                    ctx.store.add_context_source(
                        &session.id,
                        &ContextSource::Text {
                            label: "Code changes (diff)".to_string(),
                            body: format!("```diff\n{diff}\n```"),
                        },
                    )?;
                }
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

        // Drive the turn, then wait for it to genuinely finish — pausing on an
        // AskUserQuestion (the agent settled to Idle but is waiting for a reply).
        if let Err(e) = ctx
            .manager
            .run_turn(
                ctx.app.clone(),
                ctx.store.clone(),
                session.clone(),
                cfg.effective_prompt(),
            )
            .await
        {
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
        match wait_for_node(ctx, &node_id, &session.id).await {
            Ok(Some(output)) => set_node(
                ctx,
                &node_id,
                NodeRunStatus::Done,
                Some(&session.id),
                Some(&output),
                None,
            )?,
            Ok(None) => return Ok(Outcome::Canceled),
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
    Ok(Outcome::Completed)
}

/// Wait for a node's turn to truly complete. A turn that ended on an
/// `AskUserQuestion` is *not* done — it's blocked on the user; mark the node
/// `AwaitingInput` and keep waiting until they answer (in the node's session).
async fn wait_for_node(
    ctx: &RunContext,
    node_id: &str,
    session_id: &str,
) -> Result<Option<String>> {
    let mut current = NodeRunStatus::Running;
    loop {
        // A cancel request stops the live turn and bails out of the run.
        if canceled(ctx) {
            ctx.manager.cancel(&ctx.app, &ctx.store, session_id);
            return Ok(None);
        }
        match ctx.store.get_session(session_id)?.status {
            SessionStatus::Error => {
                return Err(AppError::Agent(format!(
                    "node session {session_id} ended in error"
                )));
            }
            SessionStatus::Running => {
                if current != NodeRunStatus::Running {
                    set_node(
                        ctx,
                        node_id,
                        NodeRunStatus::Running,
                        Some(session_id),
                        None,
                        None,
                    )?;
                    current = NodeRunStatus::Running;
                }
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            }
            SessionStatus::Idle => {
                if ctx.store.session_has_pending_question(session_id)? {
                    if current != NodeRunStatus::AwaitingInput {
                        set_node(
                            ctx,
                            node_id,
                            NodeRunStatus::AwaitingInput,
                            Some(session_id),
                            None,
                            None,
                        )?;
                        current = NodeRunStatus::AwaitingInput;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                } else {
                    return Ok(Some(ctx.store.get_session_assistant_text(session_id)?));
                }
            }
        }
    }
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
