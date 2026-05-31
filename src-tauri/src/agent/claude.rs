//! Building blocks for invoking the `claude` CLI in streaming-JSON mode.

use std::path::PathBuf;
use std::process::Stdio;

use tokio::process::Command;

use crate::domain::Session;
use crate::error::{AppError, Result};

/// Locate the `claude` binary on PATH.
fn resolve_claude() -> Result<PathBuf> {
    which::which("claude")
        .map_err(|_| AppError::Agent("claude CLI not found on PATH".to_string()))
}

/// Assemble the CLI argument vector for a turn. A session's first turn opens a
/// new conversation via `--session-id`; later turns resume it via `--resume`.
pub fn build_args(session: &Session, prompt: &str) -> Vec<String> {
    let mut args = vec![
        "--print".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--include-partial-messages".to_string(),
        "--model".to_string(),
        session.model.clone(),
        "--permission-mode".to_string(),
        session.permission_mode.as_cli().to_string(),
    ];

    if session.turns == 0 {
        args.push("--session-id".to_string());
    } else {
        args.push("--resume".to_string());
    }
    args.push(session.agent_session_id.clone());

    args.push(prompt.to_string());
    args
}

/// Build a ready-to-spawn `tokio` command for a turn: piped stdout/stderr, no
/// stdin, killed if the handle is dropped (so cancellation tears down the CLI).
pub fn command(session: &Session, prompt: &str) -> Result<Command> {
    let bin = resolve_claude()?;
    let mut cmd = Command::new(bin);
    cmd.args(build_args(session, prompt))
        .current_dir(&session.working_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    Ok(cmd)
}
