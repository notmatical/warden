//! Commands driving interactive PTY terminal sessions.

use tauri::ipc::Channel;

use crate::error::Result;
use crate::terminal::{self, TerminalEvent};

/// Spawn the user's shell in `working_dir` (the session's root) and stream its
/// output over `on_output`. The terminal id is the session id.
#[tauri::command]
pub async fn start_terminal(
    on_output: Channel<TerminalEvent>,
    terminal_id: String,
    working_dir: String,
    cols: u16,
    rows: u16,
) -> Result<()> {
    terminal::spawn(on_output, terminal_id, working_dir, cols, rows)
}

#[tauri::command]
pub async fn terminal_write(terminal_id: String, data: String) -> Result<()> {
    terminal::write(&terminal_id, &data)
}

#[tauri::command]
pub async fn terminal_resize(terminal_id: String, cols: u16, rows: u16) -> Result<()> {
    terminal::resize(&terminal_id, cols, rows)
}

#[tauri::command]
pub async fn stop_terminal(terminal_id: String) -> Result<()> {
    terminal::kill(&terminal_id);
    Ok(())
}
