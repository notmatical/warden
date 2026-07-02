//! Agent recipe wrappers: orchestrations that span multiple sessions. The
//! plan→code handoff lives in `warden_core::workflow::recipes`.

use tauri::State;

use warden_core::workflow::recipes::{self, PlanToCodeResult};
use warden_core::CommandResult;

use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn run_plan_to_code(
    state: State<'_, AppState>,
    project_id: String,
    task: String,
    planner_model: String,
    coder_model: String,
) -> CommandResult<PlanToCodeResult> {
    recipes::run_plan_to_code(
        state.store.clone(),
        state.manager,
        project_id,
        task,
        planner_model,
        coder_model,
    )
    .await
    .map_err(Into::into)
}
