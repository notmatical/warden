//! Probes each provider's install/version/auth, building the shared
//! [`ToolStatus`] from [`crate::cli`] plus provider-specific auth detection.

use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use super::Provider;
use crate::cli::{self, ToolStatus};
use crate::error::Result;
use crate::util::silent_command;

/// How long to wait on the network "latest version" check before giving up so a
/// status refresh never hangs the provider panel.
const LATEST_VERSION_TIMEOUT: Duration = Duration::from_secs(8);

/// Probe every provider: resolve the effective binary and read versions on a
/// worker thread, then fold in auth and the latest published version.
pub async fn status_all() -> Result<Vec<ToolStatus>> {
    let mut statuses: Vec<ToolStatus> = tauri::async_runtime::spawn_blocking(|| {
        Provider::ALL
            .iter()
            .map(|&p| {
                let mut status = cli::base_status(p.tool());
                status.authed = is_authed(p, status.path.as_deref());
                status
            })
            .collect()
    })
    .await
    .map_err(|e| crate::error::AppError::Agent(format!("provider probe failed: {e}")))?;

    for (provider, status) in Provider::ALL.iter().zip(statuses.iter_mut()) {
        cli::fill_latest(status, provider.tool(), LATEST_VERSION_TIMEOUT).await;
    }
    Ok(statuses)
}

fn is_authed(provider: Provider, binary: Option<&str>) -> bool {
    match provider {
        // `codex login status` exits 0 when logged in; the auth file is a
        // fallback in case the subcommand is unavailable on older CLIs.
        Provider::Codex => {
            let bin = binary
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("codex"));
            let mut cmd = Command::new(bin);
            cmd.args(["login", "status"]);
            let status_ok = silent_command(&mut cmd)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            status_ok || crate::util::codex_home().join("auth.json").exists()
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
