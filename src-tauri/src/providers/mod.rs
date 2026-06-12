//! The agent CLI providers that back chat sessions. Each provider owns its turn
//! adapter, CLI distribution, and auth in its own folder; the managed-binary
//! machinery they share lives in [`crate::cli`]. Providers are keyed by
//! [`crate::domain::Backend`] — one variant per provider.

pub mod claude;
pub mod codex;
pub mod context;
pub mod jsonrpc;
pub mod opencode;

use std::time::Duration;

use tauri::AppHandle;

use crate::cli::{self, Tool, ToolStatus};
use crate::domain::{AgentEvent, Backend, SessionStatus};
use crate::error::Result;
use crate::events::{emit_event, emit_session};
use crate::store::Store;

/// How long to wait on the network "latest version" check before giving up so a
/// status refresh never hangs the provider panel.
const LATEST_VERSION_TIMEOUT: Duration = Duration::from_secs(8);

/// Tool-result content larger than this is clipped to keep the event log and
/// the IPC payload bounded. Shared by every adapter that translates provider
/// output into [`AgentEvent`]s.
pub(crate) const MAX_TOOL_RESULT_CHARS: usize = 16_000;
const TRUNCATION_NOTE: &str = "… (truncated)";

impl Backend {
    /// The managed CLI tool this provider runs on.
    pub fn tool(self) -> Tool {
        match self {
            Backend::Claude => Tool::Claude,
            Backend::Codex => Tool::Codex,
            Backend::Opencode => Tool::Opencode,
        }
    }
}

/// Probe every provider: resolve the effective binary and read versions/auth on
/// a worker thread, then fold in the latest published version (best-effort).
pub async fn status_all() -> Result<Vec<ToolStatus>> {
    let mut statuses: Vec<ToolStatus> = tauri::async_runtime::spawn_blocking(|| {
        Backend::ALL
            .iter()
            .map(|&provider| {
                let mut status = cli::base_status(provider.tool());
                status.authed = match provider {
                    Backend::Claude => claude::auth::is_authed(),
                    Backend::Codex => codex::auth::is_authed(status.path.as_deref()),
                    Backend::Opencode => opencode::auth::is_authed(status.path.as_deref()),
                };
                status
            })
            .collect()
    })
    .await
    .map_err(|e| crate::error::AppError::Agent(format!("provider probe failed: {e}")))?;

    for (provider, status) in Backend::ALL.iter().zip(statuses.iter_mut()) {
        cli::fill_latest(status, provider.tool(), LATEST_VERSION_TIMEOUT).await;
    }
    Ok(statuses)
}

/// Persist and emit one translated event for a run-to-completion adapter
/// (Codex, OpenCode). The turn's terminal `Result` event also settles the
/// session back to idle and accrues the turn.
pub(crate) fn persist_event(app: &AppHandle, store: &Store, session_id: &str, event: AgentEvent) {
    let is_result = matches!(event, AgentEvent::Result { .. });
    if let Ok(record) = store.append_event(session_id, &event) {
        emit_event(app, &record);
    }
    if is_result {
        let _ = store.record_turn(session_id, 0.0);
        let _ = store.set_session_status(session_id, SessionStatus::Idle);
        if let Ok(session) = store.get_session(session_id) {
            emit_session(app, &session);
        }
    }
}

/// Clip oversized tool output to [`MAX_TOOL_RESULT_CHARS`].
pub(crate) fn clip(mut s: String) -> String {
    if s.chars().count() > MAX_TOOL_RESULT_CHARS {
        let cutoff = s
            .char_indices()
            .nth(MAX_TOOL_RESULT_CHARS)
            .map(|(i, _)| i)
            .unwrap_or(s.len());
        s.truncate(cutoff);
        s.push_str(TRUNCATION_NOTE);
    }
    s
}

pub mod commands;
