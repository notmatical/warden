//! Recipe commands: orchestrations that span multiple sessions.

use tauri::{AppHandle, State};

use crate::agent::recipes::{self, PlanToCodeResult};
use crate::error::CommandResult;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn run_plan_to_code(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    task: String,
    planner_model: String,
    coder_model: String,
) -> CommandResult<PlanToCodeResult> {
    let store = state.store.clone();
    let manager = state.manager;
    recipes::run_plan_to_code(
        app,
        store,
        manager,
        project_id,
        task,
        planner_model,
        coder_model,
    )
    .await
    .map_err(Into::into)
}
