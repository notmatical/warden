//! Orchestrates agent turns: recording the prompt, dispatching the turn to the
//! session's provider, and finalizing the outcome. The per-backend turn
//! mechanics live behind [`crate::provider::Provider`]; this layer is
//! backend-agnostic — it never matches on [`Backend`].

use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

use crate::error::{AppError, Result};
use crate::event::{emit_delta, emit_event, emit_session};
use crate::provider::{context, provider};
use crate::session::{ContextSource, Session, SessionStatus};
use crate::store::Store;
use crate::AgentEvent;

use super::session_proc;
use super::settle::{settle_turn, Outcome};
use super::stream::parse_line;
use super::transcript::get_session_assistant_text;
use crate::provider::claude::agent as claude;

/// What a completed one-shot turn produced (recipes/naming).
pub struct TurnOutput {
    pub cost_usd: f64,
    pub assistant_text: String,
}

/// Drives agent turns: interactive chat dispatches through the session's
/// provider; recipes and naming use one-shot runs. Holds no state itself —
/// cloneable for shared state in the shell.
#[derive(Clone, Copy, Default)]
pub struct AgentManager;

impl AgentManager {
    pub fn new() -> Self {
        Self
    }

    /// Record the user prompt and flip the session to `Running`. Rejects if a
    /// turn is already in flight for this session.
    fn begin_turn(&self, store: &Store, session: &Session, prompt: &str) -> Result<()> {
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
        emit_event(&record);
        store.set_session_status(&session.id, SessionStatus::Running)?;
        if let Ok(updated) = store.get_session(&session.id) {
            emit_session(&updated);
        }
        Ok(())
    }

    /// Run the Claude CLI to completion as a one-shot, persisting and emitting
    /// events as they stream. Used by [`run_turn_collect`] (recipes), which
    /// orchestrate turns sequentially and don't need a warm conversation.
    async fn run_process(store: &Store, session: &Session, prompt: &str) -> Result<TurnOutput> {
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
            tokio::spawn(async move {
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
        let stderr_task = tokio::spawn(async move {
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
                        emit_delta(&session.id, text);
                    }
                    continue;
                }
                if let AgentEvent::AssistantText { text, .. } = &event {
                    assistant_text.push_str(text);
                }
                let record = store.append_event(&session.id, &event)?;
                emit_event(&record);
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

    /// Apply a one-shot turn's outcome to the session via the shared settle
    /// routine: accrue cost and go idle on success, or record an error event and
    /// flip to `Error` on failure.
    fn finalize(&self, store: &Store, session_id: &str, result: &Result<TurnOutput>) {
        let outcome = match result {
            Ok(out) => Outcome::Ok {
                cost_usd: out.cost_usd,
            },
            Err(err) => Outcome::Failed {
                message: err.to_string(),
            },
        };
        settle_turn(store, session_id, outcome);
    }

    /// Send a turn to the session's provider. For Claude this queues a message
    /// to the persistent process (events stream in via its tailer, which flips
    /// the session back to `Idle`); the server-backed providers run the turn to
    /// completion in their adapter. A start/finish failure settles the session
    /// to `Error` here.
    pub async fn run_turn(&self, store: Store, session: Session, prompt: String) -> Result<()> {
        self.begin_turn(&store, &session, &prompt)?;

        // Assemble the session's context sources (system-prompt text + extra
        // dirs), injected per turn so live changes take effect. Resolve any
        // node-output links to the upstream session's text first.
        let mut sources = store.list_context_sources(&session.id).unwrap_or_default();
        for entry in &mut sources {
            if let ContextSource::NodeOutput { session_id, label } = &entry.source {
                let body = get_session_assistant_text(&store, session_id).unwrap_or_default();
                let label = label
                    .clone()
                    .unwrap_or_else(|| "Linked agent output".to_string());
                entry.source = ContextSource::Text { label, body };
            }
        }
        let context = context::assemble(&sources);
        let instructions = (!context.system_text.is_empty()).then_some(context.system_text);

        let run = provider(session.backend)
            .run_turn(&store, &session, &prompt, instructions.as_deref())
            .await;
        if let Err(err) = run {
            self.finalize(&store, &session.id, &Err(err));
        }
        Ok(())
    }

    /// Resume a session after the user approved previously-denied tools: kill the
    /// process so it re-spawns with the updated `--allowedTools`, then nudge the
    /// agent to continue (it retries the denied step).
    pub async fn resume(&self, store: Store, session: Session) -> Result<()> {
        self.resume_with(store, session, "Approved — please continue.".to_string())
            .await
    }

    /// Kill the session's process so it re-spawns with the session's current
    /// settings (model, permission mode, allowlist), then run `prompt` as the
    /// next turn. Backs both tool approval (continue) and plan approval (which
    /// flips the mode out of `plan` before calling this).
    pub async fn resume_with(&self, store: Store, session: Session, prompt: String) -> Result<()> {
        session_proc::kill(&session.id);
        self.run_turn(store, session, prompt).await
    }

    /// Run a turn to completion and return its assistant text. Used by recipes,
    /// which orchestrate turns sequentially and don't need cancellation.
    pub async fn run_turn_collect(
        &self,
        store: &Store,
        session: &Session,
        prompt: &str,
    ) -> Result<String> {
        self.begin_turn(store, session, prompt)?;
        let out = Self::run_process(store, session, prompt).await;
        self.finalize(store, &session.id, &out);
        out.map(|o| o.assistant_text)
    }

    /// Cancel an in-flight turn. Returns whether a turn was actually running. The
    /// conversation resumes on the next message (Claude re-spawns with
    /// `--resume`; the server-backed providers resume the thread/session).
    pub fn cancel(&self, store: &Store, session_id: &str) -> bool {
        let session = store.get_session(session_id).ok();
        let was_running = matches!(
            session.as_ref().map(|s| s.status),
            Some(SessionStatus::Running)
        );
        // Settle the status before stopping so the reader's EOF handler reads this
        // as a cancel rather than a crash.
        let _ = store.set_session_status(session_id, SessionStatus::Idle);
        // Dispatch the interrupt to the session's provider (Claude kills its
        // per-session process; Codex/OpenCode interrupt the shared-server turn).
        if let Some(backend) = session.as_ref().map(|s| s.backend) {
            provider(backend).interrupt(session_id);
        }
        if let Ok(session) = store.get_session(session_id) {
            emit_session(&session);
        }
        was_running
    }
}
