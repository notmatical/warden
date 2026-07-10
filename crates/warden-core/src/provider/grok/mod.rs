//! Everything Grok: the ACP agent adapter ([`agent`] over [`acp`]), auth, and
//! model listing. Grok ships via npm, so there is no managed distribution —
//! warden runs the `grok` copy on the system PATH.

pub mod acp;
pub mod agent;
pub mod auth;
pub mod models;

use std::path::Path;

use crate::cli::Tool;
use crate::error::Result;
use crate::provider::Provider;
use crate::session::Session;
use crate::store::Store;
use crate::{Backend, EffortLevel};

/// The Grok backend. Turns run over a per-session, pooled `grok agent stdio`
/// ACP connection; connections are torn down on app shutdown (no survival).
pub struct GrokProvider;

#[async_trait::async_trait]
impl Provider for GrokProvider {
    fn backend(&self) -> Backend {
        Backend::Grok
    }

    fn cli_tool(&self) -> Tool {
        Tool::Grok
    }

    fn handles_model(&self, model: &str) -> bool {
        model.to_ascii_lowercase().starts_with("grok/")
    }

    fn fast_model(&self) -> &'static str {
        crate::model_config::fast_workflow_model(Backend::Grok)
    }

    fn clamp_effort(&self, e: EffortLevel) -> EffortLevel {
        // Grok's `--reasoning-effort` tops out at `high`; higher tiers clamp to it.
        match e {
            EffortLevel::Xhigh | EffortLevel::Max | EffortLevel::Ultracode => EffortLevel::High,
            other => other,
        }
    }

    async fn is_authed(&self) -> bool {
        tokio::task::spawn_blocking(auth::is_authed)
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
        // Grok exposes no local conversation history to scan, so a native
        // terminal resumes only the session id captured during a turn (see the
        // terminal recipe); there is nothing to recover here.
        None
    }
}

/// Drop ANSI escape sequences from CLI output (shared by the agent + models).
pub(super) fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for c in chars.by_ref() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(ch);
    }
    out
}
