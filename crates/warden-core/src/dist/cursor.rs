//! Cursor CLI distribution: Cursor ships `cursor-agent` through its own installer
//! at `https://cursor.com/install`, which serves a POSIX shell script (macOS /
//! Linux) — there is no native-Windows installer, so on Windows the CLI runs
//! under WSL and warden can't install it. On the supported platforms warden runs
//! the official installer, which places the binary on the system PATH; the
//! install therefore resolves to [`Installed::System`], not a managed binary.
//! Raw installer output is logged, never surfaced to the user.

use crate::cli::Tool;
use crate::dist::{Installed, ToolDistribution};
use crate::error::{AppError, Result};

pub struct CursorDist;

/// User-facing failure — deliberately generic; the real cause goes to the log.
#[cfg(not(windows))]
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
        #[cfg(windows)]
        {
            let _ = tool;
            // cursor.com/install is a POSIX shell script; there's no PowerShell
            // installer. Cursor Agent on Windows runs under WSL.
            Err(AppError::Integration(
                "Cursor Agent isn't available to install on Windows directly — run it under WSL, \
                 or install from cursor.com and pick the system copy in Settings."
                    .to_string(),
            ))
        }

        #[cfg(not(windows))]
        {
            crate::dist::emit_progress(tool, "installing", "Running Cursor's installer…", 40);

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
}

/// Run Cursor's official installer. The command is a fixed constant — no caller
/// input is interpolated into the shell line.
#[cfg(not(windows))]
fn run_installer() -> std::io::Result<std::process::Output> {
    let mut cmd = std::process::Command::new("/bin/sh");
    crate::platform::silent_command(&mut cmd)
        .args(["-c", "curl -fsSL https://cursor.com/install | bash"])
        .output()
}
