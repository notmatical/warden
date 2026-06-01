//! Recipe commands: orchestrations that span multiple sessions.

use tauri::{AppHandle, State};

use crate::error::Result;
use crate::recipes::{self, PlanToCodeResult};
use crate::state::AppState;

#[tauri::command]
pub async fn run_plan_to_code(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    task: String,
    planner_model: String,
    coder_model: String,
) -> Result<PlanToCodeResult> {
    let store = state.store.clone();
    let manager = state.manager.clone();
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
}
