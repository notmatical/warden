//! Multi-agent recipes. Today: plan → code, where a planner session drafts an
//! implementation plan and a coder session executes it in the same worktree.
//!
//! TODO(revise later): this predates the workflow graph engine and overlaps it
//! conceptually — plan→code is just a Plan AgentTask edged to a Code AgentTask.
//! The intended direction is to express it as a built-in workflow graph run
//! through `service::run_workflow` and delete this bespoke orchestration. For
//! now it stays a standalone, Tauri-free service fn. See
//! docs/MONOREPO-MIGRATION.md.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::agent::AgentManager;
use crate::error::Result;
use crate::event::{emit_event, emit_session};
use crate::git::{provision_working_dir, ProvisionedDir};
use crate::session::{Session, SessionRole};
use crate::store::{NewSession, Store};
use crate::workspace::Project;
use crate::{AgentEvent, EffortLevel, PermissionMode};

/// The pair of sessions a plan → code handoff produces.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanToCodeResult {
    pub planner: Session,
    pub coder: Session,
}

/// Append a notice event to a session and emit it.
fn notice(store: &Store, session_id: &str, text: String) {
    if let Ok(record) = store.append_event(session_id, &AgentEvent::Notice { text }) {
        emit_event(&record);
    }
}

pub async fn run_plan_to_code(
    store: Store,
    manager: AgentManager,
    project_id: String,
    task: String,
    planner_model: String,
    coder_model: String,
) -> Result<PlanToCodeResult> {
    let project: Project = store.get_project(&project_id)?;
    let group_id = store.ensure_group_for_project(&project_id, &project.name)?;
    // The handoff runs two agents against one shared checkout, so it always
    // isolates in a worktree.
    let dir: ProvisionedDir = provision_working_dir(&project, true, None)?;

    let planner = store.create_session(NewSession::agent_in_dir(
        &group_id,
        &project_id,
        "Planner".to_string(),
        planner_model.clone(),
        PermissionMode::Plan,
        EffortLevel::High,
        SessionRole::Planner,
        None,
        None,
        &dir,
    ))?;
    let coder = store.create_session(NewSession::agent_in_dir(
        &group_id,
        &project_id,
        "Coder".to_string(),
        coder_model.clone(),
        PermissionMode::BypassPermissions,
        EffortLevel::High,
        SessionRole::Coder,
        Some(planner.id.clone()),
        None,
        &dir,
    ))?;

    emit_session(&planner);
    emit_session(&coder);
    // Setup narrates on the planner — it's the session that runs first.
    crate::git::setup::spawn_session_setup(&store, &planner, &project.path);

    let bg_planner = planner.clone();
    let bg_coder = coder.clone();
    tokio::spawn(async move {
        notice(
            &store,
            &bg_planner.id,
            format!("Planning with {planner_model}…"),
        );
        let plan = manager.run_turn_collect(&store, &bg_planner, &task).await;

        match plan {
            Ok(plan_text) => {
                notice(
                    &store,
                    &bg_coder.id,
                    format!("Received plan from planner — implementing with {coder_model}."),
                );
                let prompt = handoff_prompt(&planner_model, &task, &plan_text);
                let _ = manager.run_turn_collect(&store, &bg_coder, &prompt).await;
            }
            Err(e) => {
                if let Ok(record) = store.append_event(
                    &bg_coder.id,
                    &AgentEvent::Error {
                        message: e.to_string(),
                    },
                ) {
                    emit_event(&record);
                }
            }
        }
    });

    Ok(PlanToCodeResult { planner, coder })
}

fn handoff_prompt(planner_model: &str, task: &str, plan: &str) -> String {
    format!(
        "A planning agent ({planner_model}) produced this implementation plan.\n\n\
         TASK:\n{task}\n\n\
         PLAN:\n{plan}\n\n\
         Implement this plan in the current repository. Make the changes directly; \
         do not just restate the plan."
    )
}
