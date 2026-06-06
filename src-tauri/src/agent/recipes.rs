//! Multi-agent recipes. Today: plan → code, where a planner session drafts an
//! implementation plan and a coder session executes it in the same worktree.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::agent::AgentManager;
use crate::domain::{
    AgentEvent, Backend, EffortLevel, PermissionMode, Project, Session, SessionKind, SessionRole,
};
use crate::error::Result;
use crate::events::{emit_event, emit_session};
use crate::git::{provision_working_dir, ProvisionedDir};
use crate::store::{NewSession, Store};
use crate::util::uuid;

/// The pair of sessions a plan → code handoff produces.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanToCodeResult {
    pub planner: Session,
    pub coder: Session,
}

/// Build a `NewSession` that shares a provisioned worktree, varying only the
/// per-role fields. Each session still owns a distinct agent conversation id.
#[allow(clippy::too_many_arguments)]
fn session_in_dir(
    group_id: &str,
    project_id: &str,
    title: &str,
    model: String,
    permission_mode: PermissionMode,
    role: SessionRole,
    parent_id: Option<String>,
    dir: &ProvisionedDir,
) -> NewSession {
    NewSession {
        group_id: group_id.to_string(),
        project_id: project_id.to_string(),
        title: title.to_string(),
        kind: SessionKind::Agent,
        backend: Backend::Claude,
        model,
        permission_mode,
        effort: EffortLevel::High,
        role,
        // Planner/Coder carry role labels; don't auto-rename them.
        auto_named: false,
        agent_session_id: uuid(),
        terminal_command: None,
        working_dir: dir.working_dir.clone(),
        branch: dir.branch.clone(),
        base_sha: dir.base_sha.clone(),
        base_branch: dir.base_branch.clone(),
        is_isolated: dir.is_isolated,
        parent_id,
        workflow_id: None,
    }
}

/// Append a notice event to a session and emit it.
fn notice(app: &AppHandle, store: &Store, session_id: &str, text: String) {
    if let Ok(record) = store.append_event(session_id, &AgentEvent::Notice { text }) {
        emit_event(app, &record);
    }
}

pub async fn run_plan_to_code(
    app: AppHandle,
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
    let dir = provision_working_dir(&app, &project, true, None)?;

    let planner = store.create_session(session_in_dir(
        &group_id,
        &project_id,
        "Planner",
        planner_model.clone(),
        PermissionMode::Plan,
        SessionRole::Planner,
        None,
        &dir,
    ))?;
    let coder = store.create_session(session_in_dir(
        &group_id,
        &project_id,
        "Coder",
        coder_model.clone(),
        PermissionMode::BypassPermissions,
        SessionRole::Coder,
        Some(planner.id.clone()),
        &dir,
    ))?;

    emit_session(&app, &planner);
    emit_session(&app, &coder);

    let bg_planner = planner.clone();
    let bg_coder = coder.clone();
    tauri::async_runtime::spawn(async move {
        notice(
            &app,
            &store,
            &bg_planner.id,
            format!("Planning with {planner_model}…"),
        );
        let plan = manager
            .run_turn_collect(&app, &store, &bg_planner, &task)
            .await;

        match plan {
            Ok(plan_text) => {
                notice(
                    &app,
                    &store,
                    &bg_coder.id,
                    format!("Received plan from planner — implementing with {coder_model}."),
                );
                let prompt = handoff_prompt(&planner_model, &task, &plan_text);
                let _ = manager
                    .run_turn_collect(&app, &store, &bg_coder, &prompt)
                    .await;
            }
            Err(e) => {
                if let Ok(record) = store.append_event(
                    &bg_coder.id,
                    &AgentEvent::Error {
                        message: e.to_string(),
                    },
                ) {
                    emit_event(&app, &record);
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
