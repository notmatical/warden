//! Orchestrates agent turns: spawning the CLI, translating its stream into
//! persisted events, and tracking which sessions have a turn in flight.

pub mod attachments;
mod naming;
pub mod recipes;
mod session_proc;
mod stream;

pub use naming::generate_session_title;

use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

use crate::domain::{AgentEvent, Backend, ContextSource, Session, SessionStatus};
use crate::error::{AppError, Result};
use crate::events::{emit_delta, emit_event, emit_session};
use crate::store::Store;

// The per-provider turn adapters live with the rest of each provider's code.
use crate::providers::claude::agent as claude;
use crate::providers::codex::agent as codex;

use stream::parse_line;

/// Tear down every live agent process on app exit: the persistent Claude
/// session processes and the shared Codex app-server.
pub fn kill_all() {
    session_proc::kill_all();
    codex::kill_all();
}

/// What a completed one-shot turn produced (recipes/naming).
pub struct TurnOutput {
    pub cost_usd: f64,
    pub assistant_text: String,
}

/// Drives agent turns: interactive chat runs against a persistent per-session
/// process (see [`session_proc`]); recipes and naming use one-shot runs. Holds
/// no state itself — cloneable for shared Tauri state.
#[derive(Clone, Copy, Default)]
pub struct AgentManager;

impl AgentManager {
    pub fn new() -> Self {
        Self
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
        let current = store.get_session(&session.id)?;
        if current.status == SessionStatus::Running {
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
        let mut child = claude::command(session, &add_dirs)?.spawn()?;

        // Feed the prompt over stdin (not as an argument, which breaks the
        // Windows `claude.cmd` shim on multiline prompts). A separate task avoids
        // any deadlock against the stdout reader below.
        if let Some(mut stdin) = child.stdin.take() {
            let prompt = prompt.to_string();
            tauri::async_runtime::spawn(async move {
                use tokio::io::AsyncWriteExt;
                let _ = stdin.write_all(prompt.as_bytes()).await;
                let _ = stdin.shutdown().await;
            });
        }

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
                if let AgentEvent::AssistantText { text, .. } = &event {
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

    /// Send a turn to the session's persistent process (spawning it on first
    /// use). Returns once the message is queued; events stream in via the
    /// process reader, which flips the session back to `Idle` on completion.
    pub async fn run_turn(
        &self,
        app: AppHandle,
        store: Store,
        session: Session,
        prompt: String,
    ) -> Result<()> {
        self.begin_turn(&store, &app, &session, &prompt)?;

        // Assemble the session's context sources (system-prompt text + extra
        // dirs), injected per turn so live changes take effect. Resolve any
        // node-output links to the upstream session's text first.
        let mut sources = store.list_context_sources(&session.id).unwrap_or_default();
        for entry in &mut sources {
            if let ContextSource::NodeOutput { session_id, label } = &entry.source {
                let body = store
                    .get_session_assistant_text(session_id)
                    .unwrap_or_default();
                let label = label
                    .clone()
                    .unwrap_or_else(|| "Linked agent output".to_string());
                entry.source = ContextSource::Text { label, body };
            }
        }
        let context = crate::providers::context::assemble(&sources);

        if session.backend == Backend::Codex {
            // Codex runs the turn to completion in its adapter, settling the
            // session to Idle on the terminating `turn/completed`. A failure to
            // start the turn is surfaced as an error event here.
            if let Err(err) =
                codex::run_turn(&app, &store, &session, &prompt, &context.system_text).await
            {
                let failed: Result<TurnOutput> = Err(err);
                self.finalize(&app, &store, &session.id, &failed);
            }
            return Ok(());
        }

        // Hand every non-primary root, plus any context dirs, to the CLI.
        let mut add_dirs: Vec<String> = store
            .list_session_root_projects(&session.id)
            .unwrap_or_default()
            .into_iter()
            .filter(|p| p.id != session.project_id)
            .map(|p| p.path)
            .collect();
        for dir in context.add_dirs {
            if !add_dirs.contains(&dir) {
                add_dirs.push(dir);
            }
        }
        // Always grant the session's attachments dir so staged drops are readable.
        if let Ok(att_dir) = attachments::dir(&app, &session.id) {
            add_dirs.push(att_dir.to_string_lossy().into_owned());
        }

        let context_file = match write_context_file(&app, &session.id, &context.system_text) {
            Ok(file) => file,
            Err(err) => {
                let failed: Result<TurnOutput> = Err(err);
                self.finalize(&app, &store, &session.id, &failed);
                return Ok(());
            }
        };

        if let Err(err) =
            session_proc::ensure(&app, &store, &session, &add_dirs, context_file.as_deref()).await
        {
            let failed: Result<TurnOutput> = Err(err);
            self.finalize(&app, &store, &session.id, &failed);
            return Ok(());
        }
        if let Err(err) = session_proc::send(&session.id, claude::user_message_line(&prompt)) {
            let failed: Result<TurnOutput> = Err(err);
            self.finalize(&app, &store, &session.id, &failed);
        }
        Ok(())
    }

    /// Resume a session after the user approved previously-denied tools: kill the
    /// process so it re-spawns with the updated `--allowedTools`, then nudge the
    /// agent to continue (it retries the denied step).
    pub async fn resume(&self, app: AppHandle, store: Store, session: Session) -> Result<()> {
        self.resume_with(
            app,
            store,
            session,
            "Approved — please continue.".to_string(),
        )
        .await
    }

    /// Kill the session's process so it re-spawns with the session's current
    /// settings (model, permission mode, allowlist), then run `prompt` as the
    /// next turn. Backs both tool approval (continue) and plan approval (which
    /// flips the mode out of `plan` before calling this).
    pub async fn resume_with(
        &self,
        app: AppHandle,
        store: Store,
        session: Session,
        prompt: String,
    ) -> Result<()> {
        session_proc::kill(&session.id);
        self.run_turn(app, store, session, prompt).await
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

    /// Cancel an in-flight turn by killing the session's process. Returns
    /// whether a turn was actually running. The conversation resumes on the next
    /// message (the process re-spawns with `--resume`).
    pub fn cancel(&self, app: &AppHandle, store: &Store, session_id: &str) -> bool {
        let session = store.get_session(session_id).ok();
        let was_running = matches!(
            session.as_ref().map(|s| s.status),
            Some(SessionStatus::Running)
        );
        // Settle the status before stopping so the reader's EOF handler reads this
        // as a cancel rather than a crash.
        let _ = store.set_session_status(session_id, SessionStatus::Idle);
        // Codex turns run on the shared app-server — interrupt the turn; Claude
        // turns run a per-session process — kill it.
        if matches!(session.as_ref().map(|s| s.backend), Some(Backend::Codex)) {
            codex::interrupt(session_id);
        } else {
            session_proc::kill(session_id);
        }
        if let Ok(session) = store.get_session(session_id) {
            emit_session(app, &session);
        }
        was_running
    }
}

/// Drop a session's warm Claude process so the next turn respawns it with fresh
/// args — used after its context sources change. A no-op for Codex (whose
/// instructions are rebuilt each turn) and for idle sessions.
pub fn refresh_session(session_id: &str) {
    session_proc::kill(session_id);
}

/// Write a session's assembled context to a file under the app data dir for
/// Claude's `--append-system-prompt-file`, returning its path — or `None` when
/// there's no context to inject.
fn write_context_file(app: &AppHandle, session_id: &str, text: &str) -> Result<Option<String>> {
    use tauri::Manager;
    if text.is_empty() {
        return Ok(None);
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Agent(format!("no app data dir: {e}")))?
        .join("context");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Agent(e.to_string()))?;
    let path = dir.join(format!("{session_id}.md"));
    std::fs::write(&path, text).map_err(|e| AppError::Agent(e.to_string()))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

pub mod commands;
