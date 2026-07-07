//! Settings commands for the Warden MCP toggle.

use tauri::State;

use warden_core::CommandResult;

use crate::state::AppState;

/// Whether agents are given Warden's MCP tools (default on when connected).
#[tauri::command]
#[specta::specta]
pub async fn warden_mcp_enabled(state: State<'_, AppState>) -> CommandResult<bool> {
    Ok(warden_core::mcp::is_enabled(&state.store))
}

/// Turn the agent MCP tools on or off.
#[tauri::command]
#[specta::specta]
pub async fn set_warden_mcp_enabled(
    state: State<'_, AppState>,
    enabled: bool,
) -> CommandResult<()> {
    state.store.set_setting(
        warden_core::mcp::SETTING_KEY,
        if enabled { "true" } else { "false" },
    )?;
    Ok(())
}
