//! Commands driving interactive PTY terminal sessions.

use tauri::ipc::Channel;
use tauri::State;

use crate::cli;
use crate::domain::{Backend, Session};
use crate::error::{CommandResult, Result};
use crate::providers::claude::history as claude_history;
use crate::providers::codex::history as codex_history;
use crate::providers::opencode::history as opencode_history;
use crate::state::AppState;
use crate::store::Store;
use crate::terminal::{self, TerminalEvent};

/// The program + args a session's terminal should launch. A native CLI session
/// runs its provider binary — starting a fresh conversation the first time and
/// resuming it thereafter; everything else runs the user's shell.
///
/// Each provider tracks "is there a conversation to resume?" differently:
/// Claude pins its own session id but writes the conversation file lazily (only
/// after the first message), so we resume by that id only once the file exists.
/// Codex assigns its own session id, so on first resume we recover it from
/// Codex's rollout history (newest session for this cwd, not already claimed by
/// another tab) and persist it; later launches reuse the bound id.
fn launch_recipe(store: &Store, session: &Session) -> Result<(Option<String>, Vec<String>)> {
    if session.terminal_command.is_none() {
        return Ok((None, Vec::new()));
    }
    // Resolve the tool's effective binary (managed or system) so a native
    // terminal launches the same CLI as headless turns.
    let program = cli::resolve(session.backend.tool())
        .to_string_lossy()
        .into_owned();
    let args = match session.backend {
        // Claude owns its session id. Resume by that exact id only when its
        // conversation file is on disk; otherwise (re)pin the id and start
        // fresh. Re-pinning is safe precisely because no conversation exists
        // under that id yet — which is the case when the terminal was opened but
        // closed before a single message was sent.
        Backend::Claude => {
            let flag = if claude_history::conversation_exists(&session.agent_session_id) {
                "--resume"
            } else {
                "--session-id"
            };
            vec![flag.to_string(), session.agent_session_id.clone()]
        }
        // Codex: a fresh session the first time; afterwards resume the bound id.
        Backend::Codex => match session.terminal_started {
            false => Vec::new(),
            true => match codex_resume_id(store, session)? {
                Some(id) => vec!["resume".to_string(), id],
                // No rollout matched yet (e.g. nothing was sent last time): fall
                // back to Codex's own "most recent for this cwd".
                None => vec!["resume".to_string(), "--last".to_string()],
            },
        },
        // OpenCode: a fresh session the first time; afterwards resume the bound
        // id, recovered from OpenCode's session store like Codex above.
        Backend::Opencode => match session.terminal_started {
            false => Vec::new(),
            true => match opencode_resume_id(store, session)? {
                Some(id) => vec!["--session".to_string(), id],
                // No stored session matched yet (e.g. nothing was sent last
                // time): fall back to OpenCode's "most recent for this cwd".
                None => vec!["--continue".to_string()],
            },
        },
    };
    Ok((Some(program), args))
}

/// The Codex conversation id this terminal should resume, binding it on first use.
fn codex_resume_id(store: &Store, session: &Session) -> Result<Option<String>> {
    bind_resume_id(store, session, codex_history::newest_session_for_cwd)
}

/// The OpenCode conversation id this terminal should resume, binding it on first use.
fn opencode_resume_id(store: &Store, session: &Session) -> Result<Option<String>> {
    bind_resume_id(store, session, opencode_history::newest_session_for_cwd)
}

/// The provider conversation id this terminal should resume: the already-bound
/// id if any, else the newest unclaimed provider session for the terminal's
/// cwd (persisted so later launches reuse it).
fn bind_resume_id(
    store: &Store,
    session: &Session,
    find: impl Fn(&str, &std::collections::HashSet<String>) -> Option<String>,
) -> Result<Option<String>> {
    if session.terminal_resume_id.is_some() {
        return Ok(session.terminal_resume_id.clone());
    }
    let taken = store.taken_resume_ids()?;
    let found = find(&session.working_dir, &taken);
    if let Some(id) = &found {
        store.set_terminal_resume_id(&session.id, id)?;
    }
    Ok(found)
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
        Some(session) => launch_recipe(&state.store, session)?,
        None => (None, Vec::new()),
    };

    terminal::spawn(
        on_output,
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
