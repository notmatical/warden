//! Everything OpenCode: the HTTP-server agent adapter, auth, and model listing.
//! OpenCode is a multi-provider agent CLI; warden drives it through its local
//! HTTP server (`opencode serve`) rather than per-turn CLI invocations. The CLI
//! distribution lives in [`crate::dist`].

pub mod agent;
pub mod auth;
pub mod history;
pub mod models;
mod server;

use std::collections::HashSet;
use std::path::Path;

use crate::cli::{self, Tool};
use crate::error::Result;
use crate::provider::Provider;
use crate::session::Session;
use crate::store::Store;
use crate::{Backend, EffortLevel};

/// The OpenCode backend. Turns run against a shared `opencode serve` HTTP server
/// (one session per warden session); the server is torn down on app shutdown.
pub struct OpencodeProvider;

#[async_trait::async_trait]
impl Provider for OpencodeProvider {
    fn backend(&self) -> Backend {
        Backend::Opencode
    }

    fn cli_tool(&self) -> Tool {
        Tool::Opencode
    }

    fn handles_model(&self, model: &str) -> bool {
        model.to_ascii_lowercase().starts_with("opencode")
    }

    fn fast_model(&self) -> &'static str {
        crate::model_config::fast_workflow_model(Backend::Opencode)
    }

    fn clamp_effort(&self, e: EffortLevel) -> EffortLevel {
        // OpenCode tops out at `max` (no `xhigh`); higher tiers clamp to it.
        match e {
            EffortLevel::Xhigh | EffortLevel::Max | EffortLevel::Ultracode => EffortLevel::Max,
            other => other,
        }
    }

    async fn is_authed(&self) -> bool {
        // `opencode auth list` may shell out — run it off the async runtime.
        let path = cli::resolve(Tool::Opencode).to_string_lossy().into_owned();
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

    fn newest_session_for_cwd(&self, cwd: &Path) -> Option<String> {
        history::newest_session_for_cwd(&cwd.to_string_lossy(), &HashSet::new())
    }
}
