//! Commands driving interactive PTY terminal sessions.

use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::error::Result;
use crate::events::emit_session;
use crate::state::AppState;
use crate::terminal::{self, TerminalEvent};
use crate::util::uuid;

/// Spawn a `claude` PTY in `working_dir` and stream its output over `on_output`.
/// The terminal id is the session id: a fresh session opens its CLI conversation
/// via `--session-id`; reopening one resumes it via `--resume`.
#[tauri::command]
pub async fn start_terminal(
    app: AppHandle,
    state: State<'_, AppState>,
    on_output: Channel<TerminalEvent>,
    terminal_id: String,
    working_dir: String,
    cols: u16,
    rows: u16,
) -> Result<()> {
    let session = state.store.get_session(&terminal_id)?;
    let first_start = !session.pty_started;
    let flag = if first_start { "--session-id" } else { "--resume" };
    let extra_args = vec![flag.to_string(), session.agent_session_id.clone()];

    terminal::spawn(on_output, terminal_id.clone(), working_dir, cols, rows, extra_args)?;

    // On the first spawn, persist that the conversation now exists and tell the
    // UI — so reopening this session offers resume instead of silently respawning.
    if first_start {
        state.store.mark_pty_started(&terminal_id)?;
        if let Ok(updated) = state.store.get_session(&terminal_id) {
            emit_session(&app, &updated);
        }
    }
    Ok(())
}

/// Abandon a terminal session's CLI conversation: assign a new conversation id
/// and clear the started flag, so the next spawn opens a fresh one. Backs the
/// "Start fresh" choice on the resume screen.
#[tauri::command]
pub async fn reset_terminal_session(
    app: AppHandle,
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<()> {
    state
        .store
        .reset_terminal_session(&terminal_id, &uuid())?;
    if let Ok(updated) = state.store.get_session(&terminal_id) {
        emit_session(&app, &updated);
    }
    Ok(())
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
