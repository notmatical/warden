//! Orchestrates agent turns: spawning the CLI, translating its stream into
//! persisted events, and tracking which sessions have a turn in flight.

mod claude;
mod naming;
mod stream;

pub use naming::generate_session_title;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::async_runtime::JoinHandle;
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

use crate::domain::{AgentEvent, Session, SessionStatus};
use crate::error::{AppError, Result};
use crate::events::{emit_delta, emit_event, emit_session};
use crate::store::Store;

use stream::parse_line;

/// What a completed turn produced.
pub struct TurnOutput {
    pub cost_usd: f64,
    pub assistant_text: String,
}

/// Tracks in-flight turns by session id so we can enforce one-at-a-time and
/// support cancellation. Cloneable so it can live in shared Tauri state.
#[derive(Clone, Default)]
pub struct AgentManager {
    running: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
}

impl AgentManager {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, JoinHandle<()>>> {
        self.running.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn is_running(&self, id: &str) -> bool {
        self.lock().contains_key(id)
    }

    /// Record the user prompt and flip the session to `Running`. Rejects if a
    /// turn is already in flight for this session.
    fn begin_turn(
        &self,
        store: &Store,
        app: &AppHandle,
        session: &Session,
        prompt: &str,
    ) -> Result<()> {
        if self.is_running(&session.id) {
            return Err(AppError::Busy);
        }
        let record = store.append_event(
            &session.id,
            &AgentEvent::UserMessage {
                text: prompt.to_string(),
            },
        )?;
        emit_event(app, &record);
        store.set_session_status(&session.id, SessionStatus::Running)?;
        if let Ok(updated) = store.get_session(&session.id) {
            emit_session(app, &updated);
        }
        Ok(())
    }

    /// Run the CLI to completion, persisting and emitting events as they stream.
    async fn run_process(
        app: &AppHandle,
        store: &Store,
        session: &Session,
        prompt: &str,
    ) -> Result<TurnOutput> {
        // Hand every non-primary root to the CLI as an extra directory.
        let add_dirs: Vec<String> = store
            .list_session_root_projects(&session.id)
            .unwrap_or_default()
            .into_iter()
            .filter(|p| p.id != session.project_id)
            .map(|p| p.path)
            .collect();
        let mut child = claude::command(session, prompt, &add_dirs)?.spawn()?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::Agent("failed to capture agent stdout".to_string()))?;
        let mut stderr = child
            .stderr
            .take()
            .ok_or_else(|| AppError::Agent("failed to capture agent stderr".to_string()))?;

        // Drain stderr concurrently so a chatty CLI can't deadlock on a full pipe.
        let stderr_task = tauri::async_runtime::spawn(async move {
            let mut buf = String::new();
            let _ = stderr.read_to_string(&mut buf).await;
            buf
        });

        let mut cost_usd = 0.0;
        let mut assistant_text = String::new();

        let mut lines = BufReader::new(stdout).lines();
        while let Some(line) = lines.next_line().await? {
            let Some(parsed) = parse_line(&line) else {
                continue;
            };
            if let Some(c) = parsed.cost_usd {
                cost_usd = c;
            }
            for event in parsed.events {
                if event.is_transient() {
                    if let AgentEvent::TextDelta { text } = &event {
                        emit_delta(app, &session.id, text);
                    }
                    continue;
                }
                if let AgentEvent::AssistantText { text } = &event {
                    assistant_text.push_str(text);
                }
                let record = store.append_event(&session.id, &event)?;
                emit_event(app, &record);
            }
        }

        let status = child.wait().await?;
        let stderr_out = stderr_task.await.unwrap_or_default();

        if !status.success() {
            let detail = stderr_out.trim();
            let message = if detail.is_empty() {
                format!("agent exited with {status}")
            } else {
                detail.to_string()
            };
            return Err(AppError::Agent(message));
        }

        Ok(TurnOutput {
            cost_usd,
            assistant_text,
        })
    }

    /// Apply a turn's outcome to the session: accrue cost and go idle on
    /// success, or record an error event and flip to `Error` on failure.
    fn finalize(
        &self,
        app: &AppHandle,
        store: &Store,
        session_id: &str,
        result: &Result<TurnOutput>,
    ) {
        match result {
            Ok(out) => {
                let _ = store.record_turn(session_id, out.cost_usd);
                let _ = store.set_session_status(session_id, SessionStatus::Idle);
            }
            Err(err) => {
                if let Ok(record) = store.append_event(
                    session_id,
                    &AgentEvent::Error {
                        message: err.to_string(),
                    },
                ) {
                    emit_event(app, &record);
                }
                let _ = store.set_session_status(session_id, SessionStatus::Error);
            }
        }
        if let Ok(session) = store.get_session(session_id) {
            emit_session(app, &session);
        }
    }

    /// Fire-and-forget a turn: streams over events, finalizes, and removes its
    /// own handle from the running map when done.
    pub fn run_turn(
        &self,
        app: AppHandle,
        store: Store,
        session: Session,
        prompt: String,
    ) -> Result<()> {
        self.begin_turn(&store, &app, &session, &prompt)?;

        let manager = self.clone();
        let session_id = session.id.clone();
        let handle = tauri::async_runtime::spawn(async move {
            let result = Self::run_process(&app, &store, &session, &prompt).await;
            manager.finalize(&app, &store, &session.id, &result);
            manager.lock().remove(&session.id);
        });
        self.lock().insert(session_id, handle);
        Ok(())
    }

    /// Run a turn to completion and return its assistant text. Used by recipes,
    /// which orchestrate turns sequentially and don't need cancellation.
    pub async fn run_turn_collect(
        &self,
        app: &AppHandle,
        store: &Store,
        session: &Session,
        prompt: &str,
    ) -> Result<String> {
        self.begin_turn(store, app, session, prompt)?;
        let out = Self::run_process(app, store, session, prompt).await;
        self.finalize(app, store, &session.id, &out);
        out.map(|o| o.assistant_text)
    }

    /// Abort an in-flight turn. `kill_on_drop` tears down the CLI child once the
    /// handle is dropped. Returns whether a turn was actually running.
    pub fn cancel(&self, app: &AppHandle, store: &Store, session_id: &str) -> bool {
        let handle = self.lock().remove(session_id);
        let was_running = handle.is_some();
        if let Some(handle) = handle {
            handle.abort();
        }
        let _ = store.set_session_status(session_id, SessionStatus::Idle);
        if let Ok(session) = store.get_session(session_id) {
            emit_session(app, &session);
        }
        was_running
    }
}
