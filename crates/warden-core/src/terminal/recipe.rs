//! Derives the launch command for a native-CLI terminal: which provider binary
//! to run, and whether to start a fresh conversation or resume an existing one.
//!
//! Each provider tracks "is there a conversation to resume?" differently:
//! Claude pins its own session id but writes the conversation file lazily (only
//! after the first message), so we resume by that id only once the file exists.
//! Codex assigns its own session id, so on first resume we recover it from
//! Codex's rollout history (newest session for this cwd, not already claimed by
//! another tab) and persist it; later launches reuse the bound id. OpenCode
//! behaves like Codex.
//!
//! The provider-history lookups (`conversation_exists`, `newest_session_for_cwd`)
//! and the resolved binary path live in the providers tier, which has not ported
//! into `warden-core` yet. They are injected via [`RecipeDeps`] so this stays
//! Tauri-free and provider-free; the shell (or a thin core glue once providers
//! land) supplies them.

use std::collections::HashSet;

use crate::error::Result;
use crate::session::Session;
use crate::store::Store;
use crate::Backend;

/// The provider-tier hooks `launch_recipe` needs, injected so core does not
/// depend on the (not-yet-ported) providers modules.
pub struct RecipeDeps<'a> {
    /// The resolved provider binary for this session's backend (managed or
    /// system), as a launchable program string. In the shell this is
    /// `cli::resolve(session.backend.tool())`.
    pub program: String,
    /// Whether Claude has a persisted conversation on disk for the given session
    /// id — gates `--resume` vs `--session-id`. Shell: `claude::history::conversation_exists`.
    pub claude_conversation_exists: &'a dyn Fn(&str) -> bool,
    /// Newest unclaimed Codex rollout id for a cwd.
    /// Shell: `codex::history::newest_session_for_cwd`.
    pub codex_newest_for_cwd: &'a dyn Fn(&str, &HashSet<String>) -> Option<String>,
    /// Newest unclaimed OpenCode session id for a cwd.
    /// Shell: `opencode::history::newest_session_for_cwd`.
    pub opencode_newest_for_cwd: &'a dyn Fn(&str, &HashSet<String>) -> Option<String>,
}

/// The program + args a session's terminal should launch. A native CLI session
/// runs its provider binary — starting a fresh conversation the first time and
/// resuming it thereafter; everything else (no `terminal_command`) runs the
/// user's shell, signalled by `Ok((None, vec![]))`.
pub fn launch_recipe(
    store: &Store,
    session: &Session,
    deps: &RecipeDeps,
) -> Result<(Option<String>, Vec<String>)> {
    if session.terminal_command.is_none() {
        return Ok((None, Vec::new()));
    }
    let args = match session.backend {
        // Claude owns its session id. Resume by that exact id only when its
        // conversation file is on disk; otherwise (re)pin the id and start
        // fresh. Re-pinning is safe precisely because no conversation exists
        // under that id yet — which is the case when the terminal was opened but
        // closed before a single message was sent.
        Backend::Claude => {
            let flag = if (deps.claude_conversation_exists)(&session.agent_session_id) {
                "--resume"
            } else {
                "--session-id"
            };
            vec![flag.to_string(), session.agent_session_id.clone()]
        }
        // Codex: a fresh session the first time; afterwards resume the bound id.
        Backend::Codex => match session.terminal_started {
            false => Vec::new(),
            true => match bind_resume_id(store, session, deps.codex_newest_for_cwd)? {
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
            true => match bind_resume_id(store, session, deps.opencode_newest_for_cwd)? {
                Some(id) => vec!["--session".to_string(), id],
                // No stored session matched yet (e.g. nothing was sent last
                // time): fall back to OpenCode's "most recent for this cwd".
                None => vec!["--continue".to_string()],
            },
        },
    };
    Ok((Some(deps.program.clone()), args))
}

/// The provider conversation id this terminal should resume: the already-bound
/// id if any, else the newest unclaimed provider session for the terminal's
/// cwd (persisted so later launches reuse it).
pub fn bind_resume_id(
    store: &Store,
    session: &Session,
    find: impl Fn(&str, &HashSet<String>) -> Option<String>,
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
