//! Runs a repo's worktree setup/teardown commands (from `.warden/config.json`)
//! in a provisioned worktree, reporting progress into the session's event log.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tauri::AppHandle;

use crate::domain::{Session, SetupStatus};
use crate::events::emit_session;
use crate::store::Store;
use crate::workspace::config as repo_config;

use super::cli as git;

/// Generous: setup typically runs a dependency install.
const SETUP_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const TEARDOWN_TIMEOUT: Duration = Duration::from_secs(30);
/// How much trailing output a failure report keeps.
const OUTPUT_TAIL: usize = 2000;

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

fn shell_command(script: &str, cwd: &Path, repo: &Path) -> tokio::process::Command {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = tokio::process::Command::new("cmd");
        // `raw_arg` hands the chain to cmd.exe unquoted, so `&&` stays an operator.
        c.arg("/C").raw_arg(script);
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = tokio::process::Command::new("sh");
        // Login shell so user-managed tools (nvm, rustup, …) are on PATH.
        c.args(["-lc", script]);
        c
    };
    cmd.current_dir(cwd)
        .env("WARDEN_WORKTREE_PATH", cwd)
        .env("WARDEN_ROOT_PATH", repo)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // A timeout drops the future; take the child down with it.
        .kill_on_drop(true);
    cmd
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
    crate::platform::ensure_macos_path();
    let result = tokio::time::timeout(timeout, shell_command(script, cwd, repo).output()).await;
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
fn set_status(
    app: &AppHandle,
    store: &Store,
    session_id: &str,
    status: Option<SetupStatus>,
    error: Option<&str>,
) {
    if let Err(e) = store.set_session_setup(session_id, status, error) {
        log::warn!("failed to record setup status for {session_id}: {e}");
        return;
    }
    if let Ok(updated) = store.get_session(session_id) {
        emit_session(app, &updated);
    }
}

/// Kick off the repo's setup commands in a session's fresh worktree, in the
/// background. Progress is session state (`setup_status`/`setup_error`), which
/// the UI renders as a chip spinner or a dedicated failure view — not transcript
/// noise. No-op when the session isn't isolated or no setup is configured.
pub fn spawn_session_setup(app: &AppHandle, store: &Store, session: &Session, repo_path: &str) {
    if !session.is_isolated {
        return;
    }
    let config = repo_config::load_lenient(Path::new(repo_path));
    let Some(script) = join(&config.setup) else {
        // The commands were removed since the last run — clear any stale
        // failed/done state so a retry doesn't dead-end on a no-op.
        if session.setup_status.is_some() {
            set_status(app, store, &session.id, None, None);
        }
        return;
    };

    let app = app.clone();
    let store = store.clone();
    let session_id = session.id.clone();
    let worktree = PathBuf::from(&session.working_dir);
    let repo = PathBuf::from(repo_path);

    set_status(&app, &store, &session_id, Some(SetupStatus::Running), None);
    tauri::async_runtime::spawn(async move {
        let result = run_script(&script, &worktree, &repo, SETUP_TIMEOUT).await;
        // The session may have moved on while setup ran (isolation toggled, a
        // new worktree provisioned): a result for a worktree the session no
        // longer runs in must not stomp its current setup state.
        let stale = !store
            .get_session(&session_id)
            .is_ok_and(|s| s.is_isolated && Path::new(&s.working_dir) == worktree.as_path());
        if stale {
            log::info!("discarding setup result for replaced worktree {worktree:?}");
            return;
        }
        match result {
            Ok(()) => set_status(&app, &store, &session_id, Some(SetupStatus::Done), None),
            Err(reason) => set_status(
                &app,
                &store,
                &session_id,
                Some(SetupStatus::Failed),
                Some(&reason),
            ),
        }
    });
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
    tauri::async_runtime::spawn(async move {
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
