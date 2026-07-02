//! The agent CLI providers that back chat sessions, behind a [`Provider`] trait
//! and a static registry keyed by [`Backend`]. Each provider owns its turn
//! adapter and auth in its own folder; the managed-binary distribution they
//! share lives in [`crate::cli`]/[`crate::dist`]. Adding a backend takes a
//! [`Backend`] variant, an adapter implementing [`Provider`], and one line in
//! the [`PROVIDERS`] registry.

pub mod claude;
pub mod codex;
pub mod context;
pub mod jsonrpc;
pub mod opencode;

use std::collections::HashMap;
use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

use strum::VariantArray;

use crate::cli::{self, Tool, ToolStatus};
use crate::error::Result;
use crate::session::Session;
use crate::store::Store;
use crate::{Backend, EffortLevel};

/// How long to wait on the network "latest version" check before giving up so a
/// status refresh never hangs the provider panel.
const LATEST_VERSION_TIMEOUT: Duration = Duration::from_secs(8);

/// A pluggable agent backend: the behavior keyed by a [`Backend`] identity. The
/// engine dispatches every turn, auth probe, and lifecycle call through this
/// trait, so backend specifics never leak into the orchestration layer.
#[async_trait::async_trait]
pub trait Provider: Send + Sync {
    /// The [`Backend`] identity this provider implements.
    fn backend(&self) -> Backend;

    /// The managed CLI tool this provider runs on.
    fn cli_tool(&self) -> Tool;

    /// Whether this provider runs the given model id (drives backend selection
    /// from a model). Mirrors `backendForModel` in `src/lib/models.ts`.
    fn handles_model(&self, model: &str) -> bool;

    /// This provider's cheapest model, for background one-shots.
    fn fast_model(&self) -> &'static str;

    /// Clamp a session effort to the highest tier this backend accepts (Codex
    /// has no `max`; OpenCode tops out at `max`), so a session carried over from
    /// another backend still starts.
    fn clamp_effort(&self, e: EffortLevel) -> EffortLevel;

    /// Whether the provider is logged in.
    async fn is_authed(&self) -> bool;

    /// Run one interactive turn for `session` with `prompt`, optionally prefixed
    /// by assembled-context `instructions`. Persists and emits the turn's
    /// events; settles the session on completion.
    async fn run_turn(
        &self,
        store: &Store,
        session: &Session,
        prompt: &str,
        instructions: Option<&str>,
    ) -> Result<()>;

    /// Run a single cheap model call (background naming, PR drafting) and return
    /// the reply text, or `None` on any failure so callers fall back gracefully.
    async fn run_oneshot(&self, session: &Session, prompt: &str) -> Result<Option<String>>;

    /// Interrupt a session's in-flight turn (cancel). A no-op when no turn is
    /// running. Claude turns run a per-session process killed elsewhere; the
    /// server-backed providers (Codex, OpenCode) interrupt the live turn here.
    fn interrupt(&self, session_id: &str);

    /// Tear down any shared process this provider owns (app shutdown). Idempotent.
    fn kill_all(&self);

    /// The newest provider-side conversation id started in `cwd` that a native
    /// terminal can resume, or `None`. Claude pins its id up front and has none
    /// to recover.
    fn newest_session_for_cwd(&self, cwd: &Path) -> Option<String>;
}

/// The static provider registry, keyed by [`Backend`]. Built once.
static PROVIDERS: LazyLock<HashMap<Backend, Box<dyn Provider>>> = LazyLock::new(|| {
    let providers: Vec<Box<dyn Provider>> = vec![
        Box::new(claude::ClaudeProvider),
        Box::new(codex::CodexProvider),
        Box::new(opencode::OpencodeProvider),
    ];
    providers.into_iter().map(|p| (p.backend(), p)).collect()
});

/// The provider for a backend. Every [`Backend`] variant is registered (asserted
/// by a test), so this never panics for an in-tree backend.
pub fn provider(backend: Backend) -> &'static dyn Provider {
    PROVIDERS
        .get(&backend)
        .map(Box::as_ref)
        .unwrap_or_else(|| panic!("no provider registered for {backend:?}"))
}

/// The backend that runs `model`, by asking each provider. Falls back to Claude
/// when none claims it (the historical default).
pub fn backend_for_model(model: &str) -> Backend {
    Backend::VARIANTS
        .iter()
        .copied()
        .find(|&b| provider(b).handles_model(model))
        .unwrap_or(Backend::Claude)
}

/// Probe every provider: resolve the effective binary and read versions/auth,
/// then fold in the latest published version (best-effort).
pub async fn status_all() -> Result<Vec<ToolStatus>> {
    let mut statuses: Vec<ToolStatus> = Vec::with_capacity(Backend::VARIANTS.len());
    for &backend in Backend::VARIANTS {
        let p = provider(backend);
        let mut status = cli::base_status(p.cli_tool());
        status.authed = p.is_authed().await;
        statuses.push(status);
    }
    for (status, &backend) in statuses.iter_mut().zip(Backend::VARIANTS) {
        cli::fill_latest(status, provider(backend).cli_tool(), LATEST_VERSION_TIMEOUT).await;
    }
    Ok(statuses)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_backend_is_registered() {
        for &backend in Backend::VARIANTS {
            assert_eq!(
                provider(backend).backend(),
                backend,
                "registry must hold a provider for {backend:?} keyed by its own backend",
            );
        }
        assert_eq!(PROVIDERS.len(), Backend::VARIANTS.len());
    }

    #[test]
    fn cli_tool_matches_backend() {
        assert_eq!(provider(Backend::Claude).cli_tool(), Tool::Claude);
        assert_eq!(provider(Backend::Codex).cli_tool(), Tool::Codex);
        assert_eq!(provider(Backend::Opencode).cli_tool(), Tool::Opencode);
    }

    #[test]
    fn backend_for_model_routes_by_provider() {
        assert_eq!(backend_for_model("claude-opus-4"), Backend::Claude);
        assert_eq!(backend_for_model("gpt-5.5"), Backend::Codex);
        assert_eq!(backend_for_model("opencode/kimi"), Backend::Opencode);
    }
}
