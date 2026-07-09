//! Everything Cursor: the per-turn `cursor-agent` adapter, auth, and model
//! listing. Cursor ships its own CLI installer, so there is no managed
//! distribution — warden runs the copy on the system PATH.

pub mod agent;
pub mod auth;
pub mod models;

use std::path::Path;

use crate::cli::{self, Tool};
use crate::error::Result;
use crate::provider::Provider;
use crate::session::Session;
use crate::store::Store;
use crate::{Backend, EffortLevel};

/// The Cursor backend. Each turn is a throwaway `cursor-agent --print …` process;
/// the session's chat id resumes the conversation on later turns.
pub struct CursorProvider;

#[async_trait::async_trait]
impl Provider for CursorProvider {
    fn backend(&self) -> Backend {
        Backend::Cursor
    }

    fn cli_tool(&self) -> Tool {
        Tool::Cursor
    }

    fn handles_model(&self, model: &str) -> bool {
        model.to_ascii_lowercase().starts_with("cursor/")
    }

    fn fast_model(&self) -> &'static str {
        crate::model_config::fast_workflow_model(Backend::Cursor)
    }

    fn clamp_effort(&self, _e: EffortLevel) -> EffortLevel {
        // Cursor has no reasoning-effort control; every tier collapses to one
        // neutral default (the picker hides the effort control for Cursor).
        EffortLevel::Medium
    }

    async fn is_authed(&self) -> bool {
        let path = cli::resolve(Tool::Cursor).to_string_lossy().into_owned();
        tokio::task::spawn_blocking(move || auth::is_authed(Some(&path)))
            .await
            .unwrap_or(false)
    }

    async fn run_turn(
        &self,
        store: &Store,
        session: &Session,
        prompt: &str,
        instructions: Option<&str>,
    ) -> Result<()> {
        agent::run_turn(store, session, prompt, instructions.unwrap_or_default()).await
    }

    async fn run_oneshot(&self, session: &Session, prompt: &str) -> Result<Option<String>> {
        Ok(agent::run_oneshot(Path::new(&session.working_dir), prompt).await)
    }

    fn interrupt(&self, session_id: &str) {
        agent::interrupt(session_id);
    }

    fn kill_all(&self) {
        agent::kill_all();
    }

    fn newest_session_for_cwd(&self, _cwd: &Path) -> Option<String> {
        // Cursor exposes no local conversation history to scan, so a native
        // terminal resumes only the chat id captured during a turn (see the
        // terminal recipe); there is nothing to recover here.
        None
    }
}
