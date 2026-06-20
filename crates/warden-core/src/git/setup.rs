//! Runs a repo's worktree setup/teardown commands (from `.warden/config.json`)
//! in a provisioned worktree, reporting progress into the session's event log.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::sync::watch;

use crate::event::emit_session;
use crate::session::{Session, SetupStatus};
use crate::store::Store;
use crate::workspace::config as repo_config;

use super::cli as git;

/// Generous: setup typically runs a dependency install.
const SETUP_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const TEARDOWN_TIMEOUT: Duration = Duration::from_secs(30);
/// How much trailing output a failure report keeps.
const OUTPUT_TAIL: usize = 2000;

/// Observable lifecycle of a worktree's setup run, broadcast over a
/// [`watch`] channel so a waiter (the workflow executor) can block until setup
/// resolves without polling the store.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SetupState {
    /// Not started, or no setup configured (nothing to wait on).
    Pending,
    Running,
    Done,
    /// Setup failed; carries the human-readable reason.
    Failed(String),
}

impl SetupState {
    /// Whether the run has reached a terminal state.
    pub fn is_terminal(&self) -> bool {
        matches!(self, SetupState::Done | SetupState::Failed(_))
    }
}

/// A shareable handle to a session's setup run: a cloneable receiver over its
/// [`SetupState`]. Hand this to anything that must wait for setup to finish
/// (e.g. the workflow executor before it kicks off the first turn).
#[derive(Clone)]
pub struct SetupHandle {
    rx: watch::Receiver<SetupState>,
}

impl SetupHandle {
    /// A handle that is already terminal — for the no-setup / not-isolated case.
    pub fn resolved(state: SetupState) -> Self {
        let (_tx, rx) = watch::channel(state);
        SetupHandle { rx }
    }

    /// The latest known state.
    pub fn current(&self) -> SetupState {
        self.rx.borrow().clone()
    }

    /// Borrow the underlying receiver (e.g. to integrate with a select! loop).
    pub fn receiver(&self) -> watch::Receiver<SetupState> {
        self.rx.clone()
    }

    /// Await the terminal [`SetupState`]. Resolves immediately if already
    /// terminal; otherwise waits for the next transition into one. If the
    /// sender is dropped before reaching a terminal state, returns the last
    /// observed state.
    pub async fn wait(mut self) -> SetupState {
        loop {
            if self.rx.borrow().is_terminal() {
                return self.rx.borrow().clone();
            }
            if self.rx.changed().await.is_err() {
                return self.rx.borrow().clone();
            }
        }
    }
}

/// Combine non-empty commands into one `&&` chain, Superset-style: the first
/// failing command stops the rest.
fn join(commands: &[String]) -> Option<String> {
    let cmds: Vec<&str> = commands
        .iter()
        .map(|c| c.trim())
        .filter(|c| !c.is_empty())
        .collect();
    if cmds.is_empty() {
        None
    } else {
        Some(cmds.join(" && "))
    }
}

fn tail(text: &str) -> &str {
    let trimmed = text.trim();
    match trimmed.char_indices().nth_back(OUTPUT_TAIL) {
        Some((idx, _)) => &trimmed[idx..],
        None => trimmed,
    }
}

/// Run a `&&`-joined command chain in `cwd`. `Err` carries a human-readable
/// reason including the tail of the chain's output.
async fn run_script(
    script: &str,
    cwd: &Path,
    repo: &Path,
    timeout: Duration,
) -> std::result::Result<(), String> {
    let mut cmd = crate::platform::shell_command(script);
    cmd.current_dir(cwd)
        .env("WARDEN_WORKTREE_PATH", cwd)
        .env("WARDEN_ROOT_PATH", repo)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let result = tokio::time::timeout(timeout, cmd.output()).await;
    let output = match result {
        Err(_) => return Err(format!("timed out after {}s", timeout.as_secs())),
        Ok(Err(e)) => return Err(format!("failed to start shell: {e}")),
        Ok(Ok(output)) => output,
    };
    if output.status.success() {
        return Ok(());
    }
    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    Err(format!(
        "exited with {}: {}",
        output.status,
        tail(&combined)
    ))
}

/// Run the repo's setup commands in `worktree`, if any are configured.
/// Returns whether anything ran.
pub async fn run_setup(repo: &Path, worktree: &Path) -> std::result::Result<bool, String> {
    let config = repo_config::load_lenient(repo);
    let Some(script) = join(&config.setup) else {
        return Ok(false);
    };
    run_script(&script, worktree, repo, SETUP_TIMEOUT).await?;
    Ok(true)
}

/// Persist a session's setup state and push the updated session to the UI.
fn set_status(store: &Store, session_id: &str, status: Option<SetupStatus>, error: Option<&str>) {
    if let Err(e) = store.set_session_setup(session_id, status, error) {
        log::warn!("failed to record setup status for {session_id}: {e}");
        return;
    }
    if let Ok(updated) = store.get_session(session_id) {
        emit_session(&updated);
    }
}

/// Kick off the repo's setup commands in a session's fresh worktree, in the
/// background. Progress is session state (`setup_status`/`setup_error`), which
/// the UI renders as a chip spinner or a dedicated failure view — not transcript
/// noise. No-op when the session isn't isolated or no setup is configured.
///
/// Returns a [`SetupHandle`] tracking the run: terminal immediately when nothing
/// runs, otherwise resolving when the background task finishes.
pub fn spawn_session_setup(store: &Store, session: &Session, repo_path: &str) -> SetupHandle {
    if !session.is_isolated {
        return SetupHandle::resolved(SetupState::Done);
    }
    let config = repo_config::load_lenient(Path::new(repo_path));
    let Some(script) = join(&config.setup) else {
        // The commands were removed since the last run — clear any stale
        // failed/done state so a retry doesn't dead-end on a no-op.
        if session.setup_status.is_some() {
            set_status(store, &session.id, None, None);
        }
        return SetupHandle::resolved(SetupState::Done);
    };

    let store = store.clone();
    let session_id = session.id.clone();
    let worktree = PathBuf::from(&session.working_dir);
    let repo = PathBuf::from(repo_path);

    let (tx, rx) = watch::channel(SetupState::Running);
    set_status(&store, &session_id, Some(SetupStatus::Running), None);
    tokio::spawn(async move {
        let result = run_script(&script, &worktree, &repo, SETUP_TIMEOUT).await;
        // The session may have moved on while setup ran (isolation toggled, a
        // new worktree provisioned): a result for a worktree the session no
        // longer runs in must not stomp its current setup state.
        let stale = !store
            .get_session(&session_id)
            .is_ok_and(|s| s.is_isolated && Path::new(&s.working_dir) == worktree.as_path());
        if stale {
            log::info!("discarding setup result for replaced worktree {worktree:?}");
            // Resolve the handle so waiters don't hang; the session keeps its
            // current (newer) state in the store.
            let _ = tx.send(SetupState::Done);
            return;
        }
        match result {
            Ok(()) => {
                set_status(&store, &session_id, Some(SetupStatus::Done), None);
                let _ = tx.send(SetupState::Done);
            }
            Err(reason) => {
                set_status(
                    &store,
                    &session_id,
                    Some(SetupStatus::Failed),
                    Some(&reason),
                );
                let _ = tx.send(SetupState::Failed(reason));
            }
        }
    });
    SetupHandle { rx }
}

/// Run the repo's teardown commands in `worktree` (best-effort, bounded).
pub async fn run_teardown(repo: &Path, worktree: &Path) {
    let config = repo_config::load_lenient(repo);
    let Some(script) = join(&config.teardown) else {
        return;
    };
    if !worktree.exists() {
        return;
    }
    if let Err(reason) = run_script(&script, worktree, repo, TEARDOWN_TIMEOUT).await {
        log::warn!("worktree teardown failed (continuing): {reason}");
    }
}

/// Tear down and remove a worktree in the background: run the repo's teardown
/// commands, remove the worktree, then optionally delete its branch (which
/// can't go while the worktree still holds it checked out).
pub fn spawn_teardown_and_remove(repo: PathBuf, worktree: PathBuf, branch: Option<String>) {
    tokio::spawn(async move {
        run_teardown(&repo, &worktree).await;
        if let Err(e) = git::remove_worktree(&repo, &worktree) {
            log::warn!("failed to remove worktree {worktree:?}: {e}");
            return;
        }
        if let Some(branch) = branch {
            if let Err(e) = git::delete_branch(&repo, &branch) {
                log::warn!("failed to delete branch {branch}: {e}");
            }
        }
    });
}
