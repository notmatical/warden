//! Building blocks for invoking the `claude` CLI in streaming-JSON mode.

use std::path::PathBuf;
use std::process::{Output, Stdio};

use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::cli::{self, Tool};
use crate::domain::Session;
use crate::error::Result;

/// The `claude` binary to run — warden's managed copy or the system PATH one,
/// per the tool's source preference.
pub(crate) fn resolve_claude() -> PathBuf {
    cli::resolve(Tool::Claude)
}

/// Make `gh` reachable to the agent so it can open PRs / comment during a turn:
/// prepend the resolved GitHub CLI's directory to the child `PATH` and pass the
/// brokered token. A no-op for the directory prepend if `gh` can't be resolved.
fn apply_gh_env(cmd: &mut Command) {
    // Ensure we read the user's real PATH (macOS GUI apps start with a minimal one).
    crate::platform::ensure_macos_path();
    if let Some(dir) = cli::resolve(Tool::Gh).parent() {
        let sep = if cfg!(windows) { ';' } else { ':' };
        let existing = std::env::var("PATH").unwrap_or_default();
        let path = if existing.is_empty() {
            dir.to_string_lossy().into_owned()
        } else {
            format!("{}{sep}{existing}", dir.display())
        };
        cmd.env("PATH", path);
    }
    if let Some(token) = crate::integrations::github::resolve_token() {
        cmd.env("GH_TOKEN", token);
    }
}

/// Assemble the CLI argument vector for a one-shot turn. A session's first turn
/// opens a new conversation via `--session-id`; later turns resume it via
/// `--resume`. The prompt is *not* an argument — it's fed over stdin (see
/// [`run_oneshot`]) so a multiline prompt can't break the Windows `claude.cmd`
/// shim ("batch file arguments are invalid").
///
/// A `-fast` model suffix selects the priority service tier: it is stripped from
/// the `--model` value and re-applied as `--settings {"fastMode":true}`, matching
/// how the CLI expects fast mode to be requested.
pub fn build_args(session: &Session, add_dirs: &[String]) -> Vec<String> {
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
    args
}

/// Build a ready-to-spawn `tokio` command for a one-shot turn: piped stdio,
/// killed if the handle is dropped. The prompt is delivered over stdin, so call
/// [`run_oneshot`] (or write stdin yourself) after spawning. Used by recipes and
/// background naming, which don't need a persistent conversation.
pub fn command(session: &Session, add_dirs: &[String]) -> Result<Command> {
    let bin = resolve_claude();
    let mut cmd = Command::new(bin);
    cmd.args(build_args(session, add_dirs))
        .current_dir(&session.working_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_gh_env(&mut cmd);
    Ok(cmd)
}

/// Run a one-shot `claude` command to completion, feeding `prompt` over stdin
/// rather than as an argument. Passing the prompt as an argument breaks on
/// Windows when the agent is a `claude.cmd` shim — a multiline prompt isn't a
/// valid batch-file argument — so stdin is used on every platform. The command
/// must have `stdin` piped (use [`command`] or set it yourself).
pub async fn run_oneshot(mut cmd: Command, prompt: &str) -> std::io::Result<Output> {
    let mut child = cmd.spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(prompt.as_bytes()).await?;
        stdin.shutdown().await?;
    }
    child.wait_with_output().await
}

/// Args for a persistent, bidirectional session process: events stream out and
/// user messages stream in over stdin (`--input-format stream-json`), so the
/// conversation stays warm across turns. No prompt is baked in.
///
/// `resume` forces `--resume` even when `turns == 0`: a first turn that was
/// cancelled never records a turn, but Claude already created the session id, so
/// re-running `--session-id` would fail with "already in use". The caller passes
/// `true` once the session has been initialized.
pub fn session_args(
    session: &Session,
    add_dirs: &[String],
    context_file: Option<&str>,
    resume: bool,
) -> Vec<String> {
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

    // The session's assembled context sources, appended to the system prompt.
    if let Some(path) = context_file {
        args.push("--append-system-prompt-file".to_string());
        args.push(path.to_string());
    }

    // User-approved tool patterns. `--allowedTools` is variadic; the following
    // `--session-id`/`--resume` flag terminates it.
    if !session.allowed_tools.is_empty() {
        args.push("--allowedTools".to_string());
        for pattern in &session.allowed_tools {
            args.push(pattern.clone());
        }
    }

    // A brand-new session opens its conversation; one that already exists (a
    // later turn, a re-spawn after a kill/cancel, or an app restart) resumes it.
    if resume || session.turns > 0 {
        args.push("--resume".to_string());
    } else {
        args.push("--session-id".to_string());
    }
    args.push(session.agent_session_id.clone());
    args
}

/// Build the persistent session command with stdin piped. The caller redirects
/// stdout/stderr (to per-session files, so the process can outlive the app) and
/// deliberately does NOT set `kill_on_drop` — survival is the point.
pub fn session_command(
    session: &Session,
    add_dirs: &[String],
    context_file: Option<&str>,
    resume: bool,
) -> Result<Command> {
    let bin = resolve_claude();
    let mut cmd = Command::new(bin);
    cmd.args(session_args(session, add_dirs, context_file, resume))
        .current_dir(&session.working_dir)
        .stdin(Stdio::piped());
    apply_gh_env(&mut cmd);
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
