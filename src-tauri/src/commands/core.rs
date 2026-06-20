//! Shell-level commands that don't belong to a domain: window focus reporting
//! that drives the focus-tiered pollers in `warden_core::poll`.

use tauri::State;

use warden_core::CommandResult;

use crate::state::AppState;

/// Frontend focus reporting: window focus/blur events land here.
#[tauri::command]
#[specta::specta]
pub async fn set_app_focus_state(state: State<'_, AppState>, focused: bool) -> CommandResult<()> {
    state.focus.set_focused(focused);
    Ok(())
}
