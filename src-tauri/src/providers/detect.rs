//! Best-effort probing of provider install/version/auth. Each probe shells out
//! to the CLI or inspects its credential files; failures degrade gracefully to
//! "not installed / not authed" rather than erroring.

use std::path::PathBuf;
use std::process::Command;

use super::{Provider, ProviderStatus};
use crate::error::Result;
use crate::util::silent_command;

/// Probe every provider. Runs the blocking detection on a worker thread so the
/// async runtime is never stalled by `which`/`--version` spawns.
pub async fn status_all() -> Result<Vec<ProviderStatus>> {
    let statuses = tauri::async_runtime::spawn_blocking(|| {
        Provider::ALL.iter().map(|&p| status_of(p)).collect()
    })
    .await
    .map_err(|e| crate::error::AppError::Agent(format!("provider probe failed: {e}")))?;
    Ok(statuses)
}

fn status_of(provider: Provider) -> ProviderStatus {
    let installed = which::which(provider.bin()).is_ok();
    let version = if installed { version_of(provider) } else { None };
    let authed = installed && is_authed(provider);
    ProviderStatus {
        id: provider.id().to_string(),
        name: provider.name().to_string(),
        installed,
        version,
        authed,
    }
}

/// Parse a version out of `<cli> --version`. Both CLIs print the number as the
/// first whitespace-delimited token that contains a digit (e.g. `2.1.161
/// (Claude Code)`, `codex-cli 0.136.0`).
fn version_of(provider: Provider) -> Option<String> {
    let mut cmd = Command::new(provider.bin());
    cmd.arg("--version");
    let output = silent_command(&mut cmd).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    text.split_whitespace()
        .find(|tok| tok.chars().any(|c| c.is_ascii_digit()))
        .map(|tok| tok.to_string())
}

fn is_authed(provider: Provider) -> bool {
    match provider {
        // `codex login status` exits 0 when logged in; the auth file is a
        // fallback in case the subcommand is unavailable on older CLIs.
        Provider::Codex => {
            let mut cmd = Command::new(provider.bin());
            cmd.args(["login", "status"]);
            let status_ok = silent_command(&mut cmd)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            status_ok || codex_home().join("auth.json").exists()
        }
        // Claude has no status subcommand; infer from its stored credentials.
        Provider::Claude => {
            let home = home_dir();
            home.join(".claude").join(".credentials.json").exists()
                || home.join(".claude.json").exists()
        }
    }
}

fn home_dir() -> PathBuf {
    crate::util::home_dir().unwrap_or_default()
}

/// Codex honours `$CODEX_HOME`, defaulting to `~/.codex`.
fn codex_home() -> PathBuf {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join(".codex"))
}
