//! Everything Codex: the app-server agent adapter, auth, and rollout history
//! (for resuming native terminal sessions). The CLI distribution lives in
//! [`crate::dist`].

pub mod agent;
pub mod auth;
pub mod history;

use std::collections::HashSet;
use std::path::Path;

use crate::cli::{self, Tool};
use crate::error::Result;
use crate::provider::Provider;
use crate::session::Session;
use crate::store::Store;
use crate::{Backend, EffortLevel};

/// The Codex backend. Turns run against a shared `codex app-server` JSON-RPC
/// process (one thread per session); the server is torn down on app shutdown.
pub struct CodexProvider;

#[async_trait::async_trait]
impl Provider for CodexProvider {
    fn backend(&self) -> Backend {
        Backend::Codex
    }

    fn cli_tool(&self) -> Tool {
        Tool::Codex
    }

    fn handles_model(&self, model: &str) -> bool {
        let id = model.to_ascii_lowercase();
        id.starts_with("gpt") || id.starts_with("codex")
    }

    fn fast_model(&self) -> &'static str {
        crate::model_config::fast_workflow_model(Backend::Codex)
    }

    fn clamp_effort(&self, e: EffortLevel) -> EffortLevel {
        // Codex omits Claude's `max`/`ultracode`; both clamp to `xhigh`.
        match e {
            EffortLevel::Max | EffortLevel::Ultracode => EffortLevel::Xhigh,
            other => other,
        }
    }

    async fn is_authed(&self) -> bool {
        // `codex login status` shells out — run it off the async runtime.
        let path = cli::resolve(Tool::Codex).to_string_lossy().into_owned();
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
        Ok(crate::agent::oneshot::run_codex(Path::new(&session.working_dir), prompt).await)
    }

    fn interrupt(&self, session_id: &str) {
        agent::interrupt(session_id);
    }

    fn kill_all(&self) {
        agent::kill_all();
    }

    fn newest_session_for_cwd(&self, cwd: &Path) -> Option<String> {
        history::newest_session_for_cwd(&cwd.to_string_lossy(), &HashSet::new())
    }
}
