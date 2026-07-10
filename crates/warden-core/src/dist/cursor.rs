//! Cursor CLI distribution: Cursor ships `cursor-agent` through its own installer
//! at `https://cursor.com/install`, which serves a POSIX shell script by default
//! and a PowerShell script when passed `?win32=true`. warden runs the official
//! installer for the host, which places the binary on the system PATH; the
//! install therefore resolves to [`Installed::System`], not a managed binary.
//! Raw installer output is logged, never surfaced to the user.

use crate::cli::Tool;
use crate::dist::{emit_progress, Installed, ToolDistribution};
use crate::error::{AppError, Result};

pub struct CursorDist;

/// User-facing failure — deliberately generic; the real cause goes to the log.
fn install_failed() -> AppError {
    AppError::Integration(
        "Couldn't install Cursor Agent. Install it from cursor.com, then pick the system copy in \
         Settings."
            .to_string(),
    )
}

#[async_trait::async_trait]
impl ToolDistribution for CursorDist {
    async fn latest_version(&self) -> Result<String> {
        // The vendor installer always fetches the newest build and self-updates,
        // so warden has no managed version to resolve or compare against.
        Err(AppError::Integration(
            "Cursor self-updates via its own installer".to_string(),
        ))
    }

    async fn install(&self, tool: Tool, _version: Option<&str>) -> Result<Installed> {
        emit_progress(tool, "installing", "Running Cursor's installer…", 40);

        // `output()` blocks (the installer downloads + runs); keep it off the
        // async runtime.
        let output = tokio::task::spawn_blocking(run_installer)
            .await
            .map_err(|e| {
                log::error!("cursor install task panicked: {e}");
                install_failed()
            })?
            .map_err(|e| {
                log::warn!("failed to spawn Cursor installer: {e}");
                install_failed()
            })?;

        if !output.status.success() {
            log::warn!(
                "Cursor installer exited {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            );
            return Err(install_failed());
        }
        Ok(Installed::System)
    }
}

/// Run Cursor's official installer for the host. The command is a fixed constant
/// — no caller input is interpolated into the shell line. `?win32=true` selects
/// the PowerShell installer; the bare URL serves the POSIX one.
fn run_installer() -> std::io::Result<std::process::Output> {
    #[cfg(windows)]
    {
        let mut cmd = std::process::Command::new("powershell");
        crate::platform::silent_command(&mut cmd)
            .args([
                "-NoProfile",
                "-Command",
                "irm 'https://cursor.com/install?win32=true' | iex",
            ])
            .output()
    }
    #[cfg(not(windows))]
    {
        let mut cmd = std::process::Command::new("/bin/sh");
        crate::platform::silent_command(&mut cmd)
            .args(["-c", "curl -fsSL https://cursor.com/install | bash"])
            .output()
    }
}
