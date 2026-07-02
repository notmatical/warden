//! Everything Claude: the headless agent adapter and auth. The CLI distribution
//! lives in [`crate::dist`]; the persistent per-session process machinery the
//! interactive turn drives lives in [`crate::agent::session_proc`].

pub mod agent;
pub mod auth;
pub mod history;

use std::path::Path;

use crate::agent::{attachments, session_proc};
use crate::cli::Tool;
use crate::error::{AppError, Result};
use crate::provider::{context, Provider};
use crate::session::Session;
use crate::store::Store;
use crate::{paths, Backend, EffortLevel};

/// The Claude backend. Interactive turns run a persistent, survivable
/// per-session `claude` process (see [`crate::agent::session_proc`]); one-shots
/// run a throwaway `claude -p`.
pub struct ClaudeProvider;

#[async_trait::async_trait]
impl Provider for ClaudeProvider {
    fn backend(&self) -> Backend {
        Backend::Claude
    }

    fn cli_tool(&self) -> Tool {
        Tool::Claude
    }

    fn handles_model(&self, model: &str) -> bool {
        // Claude is the default backend: it claims anything the others don't.
        let id = model.to_ascii_lowercase();
        !(id.starts_with("opencode") || id.starts_with("gpt") || id.starts_with("codex"))
    }

    fn fast_model(&self) -> &'static str {
        crate::model_config::fast_workflow_model(Backend::Claude)
    }

    fn clamp_effort(&self, e: EffortLevel) -> EffortLevel {
        // Claude accepts every tier (Ultracode is special-cased into xhigh +
        // settings by the arg builder), so nothing to clamp.
        e
    }

    async fn is_authed(&self) -> bool {
        auth::is_authed()
    }

    /// Send a turn to the session's persistent process (spawning it on first
    /// use). Returns once the message is queued; events stream in via the
    /// process tailer, which flips the session back to `Idle` on completion.
    async fn run_turn(
        &self,
        store: &Store,
        session: &Session,
        prompt: &str,
        instructions: Option<&str>,
    ) -> Result<()> {
        // Hand every non-primary root, plus any context dirs, to the CLI. The
        // context dirs come from the session's File/Dir sources, which are
        // unaffected by the NodeOutput→Text resolution the engine did before
        // building `instructions`, so re-assembling here yields the same dirs.
        let mut add_dirs: Vec<String> = store
            .list_session_root_projects(&session.id)
            .unwrap_or_default()
            .into_iter()
            .filter(|p| p.id != session.project_id)
            .map(|p| p.path)
            .collect();
        let sources = store.list_context_sources(&session.id).unwrap_or_default();
        for dir in context::assemble(&sources).add_dirs {
            if !add_dirs.contains(&dir) {
                add_dirs.push(dir);
            }
        }
        // Always grant the session's attachments dir so staged drops are readable.
        if let Ok(att_dir) = attachments::dir(&session.id) {
            add_dirs.push(att_dir.to_string_lossy().into_owned());
        }

        let context_file = write_context_file(&session.id, instructions.unwrap_or_default())?;

        session_proc::ensure(store, session, &add_dirs, context_file.as_deref()).await?;
        session_proc::send(&session.id, agent::user_message_line(prompt))
    }

    /// `claude -p` with JSON output; the reply is the envelope's `result` string.
    async fn run_oneshot(&self, session: &Session, prompt: &str) -> Result<Option<String>> {
        Ok(crate::agent::oneshot::run_claude(Path::new(&session.working_dir), prompt).await)
    }

    fn interrupt(&self, session_id: &str) {
        // Claude turns run a per-session process; cancel kills it.
        session_proc::kill(session_id);
    }

    fn kill_all(&self) {
        // Claude session processes are deliberately left running across app
        // shutdown — each finishes its in-flight turn and exits on stdin EOF,
        // and the next launch reattaches (see `session_proc::recover`).
    }

    fn newest_session_for_cwd(&self, _cwd: &Path) -> Option<String> {
        // Claude pins its conversation id up front (`--session-id`), so there is
        // nothing to recover by scanning history.
        None
    }
}

/// Write a session's assembled context to a file under the app data dir for
/// Claude's `--append-system-prompt-file`, returning its path — or `None` when
/// there's no context to inject.
fn write_context_file(session_id: &str, text: &str) -> Result<Option<String>> {
    if text.is_empty() {
        return Ok(None);
    }
    let path = paths::context_dir()?.join(format!("{session_id}.md"));
    std::fs::write(&path, text).map_err(|e| AppError::Agent(e.to_string()))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}
