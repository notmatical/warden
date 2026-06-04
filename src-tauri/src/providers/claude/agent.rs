//! Building blocks for invoking the `claude` CLI in streaming-JSON mode.

use std::path::PathBuf;
use std::process::Stdio;

use tokio::process::Command;

use crate::cli::{self, Tool};
use crate::domain::Session;
use crate::error::Result;

/// The `claude` binary to run — warden's managed copy or the system PATH one,
/// per the tool's source preference.
pub(crate) fn resolve_claude() -> PathBuf {
    cli::resolve(Tool::Claude)
}

/// Assemble the CLI argument vector for a turn. A session's first turn opens a
/// new conversation via `--session-id`; later turns resume it via `--resume`.
///
/// A `-fast` model suffix selects the priority service tier: it is stripped from
/// the `--model` value and re-applied as `--settings {"fastMode":true}`, matching
/// how the CLI expects fast mode to be requested.
pub fn build_args(session: &Session, prompt: &str, add_dirs: &[String]) -> Vec<String> {
    let (model, fast) = match session.model.strip_suffix("-fast") {
        Some(base) => (base.to_string(), true),
        None => (session.model.clone(), false),
    };

    let mut args = vec![
        "--print".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--include-partial-messages".to_string(),
        "--model".to_string(),
        model,
        "--permission-mode".to_string(),
        session.permission_mode.as_cli().to_string(),
        "--effort".to_string(),
        session.effort.as_cli().to_string(),
    ];

    if fast {
        args.push("--settings".to_string());
        args.push(r#"{"fastMode":true}"#.to_string());
    }

    for dir in add_dirs {
        if dir.is_empty() {
            continue;
        }
        args.push("--add-dir".to_string());
        args.push(dir.clone());
    }

    if session.turns == 0 {
        args.push("--session-id".to_string());
    } else {
        args.push("--resume".to_string());
    }
    args.push(session.agent_session_id.clone());

    args.push(prompt.to_string());
    args
}

/// Build a ready-to-spawn `tokio` command for a one-shot turn: piped
/// stdout/stderr, no stdin, killed if the handle is dropped. Used by recipes and
/// background naming, which don't need a persistent conversation.
pub fn command(session: &Session, prompt: &str, add_dirs: &[String]) -> Result<Command> {
    let bin = resolve_claude();
    let mut cmd = Command::new(bin);
    cmd.args(build_args(session, prompt, add_dirs))
        .current_dir(&session.working_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    Ok(cmd)
}

/// Args for a persistent, bidirectional session process: events stream out and
/// user messages stream in over stdin (`--input-format stream-json`), so the
/// conversation stays warm across turns. No prompt is baked in.
pub fn session_args(session: &Session, add_dirs: &[String]) -> Vec<String> {
    let (model, fast) = match session.model.strip_suffix("-fast") {
        Some(base) => (base.to_string(), true),
        None => (session.model.clone(), false),
    };

    let mut args = vec![
        "--print".to_string(),
        "--input-format".to_string(),
        "stream-json".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--include-partial-messages".to_string(),
        "--model".to_string(),
        model,
        "--permission-mode".to_string(),
        session.permission_mode.as_cli().to_string(),
        "--effort".to_string(),
        session.effort.as_cli().to_string(),
    ];

    if fast {
        args.push("--settings".to_string());
        args.push(r#"{"fastMode":true}"#.to_string());
    }

    for dir in add_dirs {
        if dir.is_empty() {
            continue;
        }
        args.push("--add-dir".to_string());
        args.push(dir.clone());
    }

    // User-approved tool patterns. `--allowedTools` is variadic; the following
    // `--session-id`/`--resume` flag terminates it.
    if !session.allowed_tools.is_empty() {
        args.push("--allowedTools".to_string());
        for pattern in &session.allowed_tools {
            args.push(pattern.clone());
        }
    }

    // A brand-new session opens its conversation; a re-spawned one (process was
    // killed, or the app restarted) resumes the existing conversation.
    if session.turns == 0 {
        args.push("--session-id".to_string());
    } else {
        args.push("--resume".to_string());
    }
    args.push(session.agent_session_id.clone());
    args
}

/// Build the persistent session command: stdin/stdout/stderr all piped.
pub fn session_command(session: &Session, add_dirs: &[String]) -> Result<Command> {
    let bin = resolve_claude();
    let mut cmd = Command::new(bin);
    cmd.args(session_args(session, add_dirs))
        .current_dir(&session.working_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    Ok(cmd)
}

/// Serialize one user message as a stream-json input line.
pub fn user_message_line(text: &str) -> String {
    serde_json::json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": [{ "type": "text", "text": text }],
        },
    })
    .to_string()
}
