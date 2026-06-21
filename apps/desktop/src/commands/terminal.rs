//! Terminal command wrappers for interactive PTY sessions. Core owns the PTY,
//! registry, and launch-recipe logic; the shell adapts the Tauri channel to a
//! `TerminalSink` and supplies the provider-history hooks the recipe needs.

use tauri::ipc::Channel;
use tauri::State;

use warden_core::provider::{claude, codex, opencode, provider};
use warden_core::terminal::{self, launch_recipe, RecipeDeps, TerminalEvent, TerminalSink};
use warden_core::{cli, Backend, CommandResult, Session};

use crate::state::AppState;

/// Adapts a Tauri `Channel<TerminalEvent>` to core's [`TerminalSink`], so the
/// PTY reader thread in `warden_core::terminal` can stream output without ever
/// naming Tauri.
struct ChannelSink(Channel<TerminalEvent>);

impl TerminalSink for ChannelSink {
    fn send_output(&self, data: String) -> bool {
        self.0.send(TerminalEvent::Output { data }).is_ok()
    }

    fn send_exit(&self, code: Option<i32>) {
        let _ = self.0.send(TerminalEvent::Exit { code });
    }
}

/// The provider-history hooks `launch_recipe` needs, resolving the effective
/// binary (managed or system) and binding the provider-history lookups.
fn recipe_deps(session: &Session) -> RecipeDeps<'static> {
    let program = cli::resolve(provider(session.backend).cli_tool())
        .to_string_lossy()
        .into_owned();
    RecipeDeps {
        program,
        claude_conversation_exists: &claude::history::conversation_exists,
        codex_newest_for_cwd: &codex::history::newest_session_for_cwd,
        opencode_newest_for_cwd: &opencode::history::newest_session_for_cwd,
    }
}

/// Spawn a PTY in `working_dir` (the session's root) and stream its output over
/// `on_output`. The terminal id is the session id; the launch command is derived
/// from the persisted session, so a native CLI session relaunches (and resumes)
/// its provider across app restarts instead of falling back to a bare shell.
#[tauri::command]
#[specta::specta]
pub async fn start_terminal(
    on_output: Channel<TerminalEvent>,
    state: State<'_, AppState>,
    terminal_id: String,
    working_dir: String,
    cols: u16,
    rows: u16,
) -> CommandResult<()> {
    let session = state.store.get_session(&terminal_id).ok();
    let (command, args) = match session.as_ref() {
        Some(session) => launch_recipe(&state.store, session, &recipe_deps(session))?,
        None => (None, Vec::new()),
    };

    terminal::spawn(
        ChannelSink(on_output),
        terminal_id.clone(),
        working_dir,
        command,
        args,
        cols,
        rows,
    )?;

    // First launch of a native Codex/OpenCode session: flip to resume mode for
    // next time. (Claude decides resume-vs-fresh from its on-disk conversation
    // file, so it doesn't rely on this flag.)
    if let Some(session) = session {
        if matches!(session.backend, Backend::Codex | Backend::Opencode)
            && session.terminal_command.is_some()
            && !session.terminal_started
        {
            state.store.set_terminal_started(&terminal_id)?;
        }
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn terminal_write(terminal_id: String, data: String) -> CommandResult<()> {
    terminal::write(&terminal_id, &data).map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn terminal_resize(terminal_id: String, cols: u16, rows: u16) -> CommandResult<()> {
    terminal::resize(&terminal_id, cols, rows).map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn stop_terminal(terminal_id: String) -> CommandResult<()> {
    terminal::kill(&terminal_id);
    Ok(())
}
