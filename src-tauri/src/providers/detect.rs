//! Best-effort probing of provider install/version/auth. Each probe inspects the
//! resolved binary (managed or system, per the source preference) or the CLI's
//! credential files; failures degrade gracefully to "not installed / not authed".

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use super::{install, manage, Provider, ProviderStatus};
use crate::error::Result;
use crate::util::silent_command;

/// How long to wait on the network "latest version" check before giving up so a
/// status refresh never hangs the provider panel.
const LATEST_VERSION_TIMEOUT: Duration = Duration::from_secs(8);

/// Probe every provider: resolve its effective binary, read versions and auth on
/// a worker thread, then fold in the latest published version (best-effort).
pub async fn status_all() -> Result<Vec<ProviderStatus>> {
    let mut statuses: Vec<ProviderStatus> =
        tauri::async_runtime::spawn_blocking(|| Provider::ALL.iter().map(|&p| probe(p)).collect())
            .await
            .map_err(|e| crate::error::AppError::Agent(format!("provider probe failed: {e}")))?;

    for status in &mut statuses {
        // The "update available" check only applies to an installed managed copy,
        // so skip the network round-trip for everything else (e.g. system PATH).
        let Some(provider) = Provider::parse(&status.id).filter(|_| status.managed_installed)
        else {
            continue;
        };
        let latest =
            tokio::time::timeout(LATEST_VERSION_TIMEOUT, install::latest_version(provider))
                .await
                .ok()
                .and_then(|r| r.ok());
        if let (Some(latest), Some(current)) = (&latest, &status.managed_version) {
            status.update_available = install::is_newer(current.as_str(), latest.as_str());
        }
        status.latest_version = latest;
    }
    Ok(statuses)
}

/// The blocking half of a provider's status: paths, versions, and auth.
fn probe(provider: Provider) -> ProviderStatus {
    let resolved = manage::resolve(provider);
    let version = install::current_version(&resolved);
    let system_detected = manage::system_binary(provider).is_some();
    let managed = manage::managed_installed(provider);
    let managed_version = managed.as_deref().and_then(install::current_version);

    ProviderStatus {
        id: provider.id().to_string(),
        name: provider.name().to_string(),
        source: manage::source(provider).as_str().to_string(),
        installed: version.is_some(),
        version,
        path: Some(resolved.to_string_lossy().to_string()),
        authed: is_authed(provider, &resolved),
        system_detected,
        managed_installed: managed.is_some(),
        managed_version,
        latest_version: None,
        update_available: false,
    }
}

fn is_authed(provider: Provider, binary: &Path) -> bool {
    match provider {
        // `codex login status` exits 0 when logged in; the auth file is a
        // fallback in case the subcommand is unavailable on older CLIs.
        Provider::Codex => {
            let mut cmd = Command::new(binary);
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
