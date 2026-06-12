//! Background one-shots ("fast workflows": session naming, PR drafting): a
//! single cheap model call routed to the session's backend, using that
//! provider's fast-workflow model from the shared models config. Returns the
//! reply text, or `None` on any failure so callers can fall back gracefully.

use std::path::Path;
use std::process::Stdio;

use tokio::process::Command;

use crate::domain::Backend;
use crate::model_config::fast_workflow_model;
use crate::providers::claude::agent::{resolve_claude, run_oneshot};

pub async fn run(backend: Backend, working_dir: &Path, prompt: &str) -> Option<String> {
    match backend {
        Backend::Claude => run_claude(working_dir, prompt).await,
        Backend::Codex => run_codex(working_dir, prompt).await,
        Backend::Opencode => {
            crate::providers::opencode::agent::run_oneshot(working_dir, prompt).await
        }
    }
}

/// `claude -p` with JSON output; the reply is the envelope's `result` string.
/// The prompt goes over stdin, not as an argument: a multiline prompt can't be
/// passed to a Windows `claude.cmd` shim ("batch file arguments are invalid").
async fn run_claude(working_dir: &Path, prompt: &str) -> Option<String> {
    let bin = resolve_claude();
    let mut cmd = Command::new(&bin);
    cmd.args([
        "-p",
        "--output-format",
        "json",
        "--model",
        fast_workflow_model(Backend::Claude),
        "--permission-mode",
        "bypassPermissions",
        "--max-turns",
        "1",
    ])
    .current_dir(working_dir)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true);

    let output = match run_oneshot(cmd, prompt).await {
        Ok(output) => output,
        Err(e) => {
            log::warn!("oneshot: failed to spawn {bin:?}: {e}");
            return None;
        }
    };
    if !output.status.success() {
        log::warn!(
            "oneshot: claude exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        );
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let value: serde_json::Value = match serde_json::from_str(stdout.trim()) {
        Ok(value) => value,
        Err(e) => {
            log::warn!("oneshot: unparseable claude JSON ({e}): {}", stdout.trim());
            return None;
        }
    };
    match value.get("result").and_then(|r| r.as_str()) {
        Some(result) => Some(result.to_string()),
        None => {
            log::warn!("oneshot: claude response had no `result` string: {value}");
            None
        }
    }
}

/// `codex exec` in a read-only sandbox; the reply lands in a temp file via
/// `--output-last-message` (stdout carries progress logs). The prompt goes over
/// stdin (`-`), for the same Windows shim reason as claude.
async fn run_codex(working_dir: &Path, prompt: &str) -> Option<String> {
    let out_file = std::env::temp_dir().join(format!("warden-oneshot-{}.txt", crate::util::uuid()));
    let bin = crate::cli::resolve(crate::cli::Tool::Codex);
    let mut cmd = Command::new(&bin);
    cmd.args([
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--model",
        fast_workflow_model(Backend::Codex),
        "--output-last-message",
    ])
    .arg(&out_file)
    .arg("-")
    .current_dir(working_dir)
    .stdin(Stdio::piped())
    .stdout(Stdio::null())
    .stderr(Stdio::piped())
    .kill_on_drop(true);

    let output = match run_oneshot(cmd, prompt).await {
        Ok(output) => output,
        Err(e) => {
            log::warn!("oneshot: failed to spawn {bin:?}: {e}");
            return None;
        }
    };
    let result = std::fs::read_to_string(&out_file).ok();
    let _ = std::fs::remove_file(&out_file);
    if !output.status.success() {
        log::warn!(
            "oneshot: codex exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        );
        return None;
    }
    result.filter(|s| !s.trim().is_empty())
}
