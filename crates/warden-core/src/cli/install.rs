//! Install orchestration shared by every managed tool: emit progress, write the
//! downloaded binary atomically, make it runnable, and verify it. The bytes and
//! latest-version lookup for a given tool come from that tool's
//! [`ToolDistribution`](crate::dist::ToolDistribution), dispatched by
//! [`crate::dist::distribution`].

use super::{paths, Tool};
use crate::dist;
use crate::error::{AppError, Result};
use crate::event::{self, payloads::InstallProgress};
use crate::net::version::extract_version;

/// Emit an install-progress event to the frontend.
pub fn emit_progress(tool: Tool, stage: &str, message: &str, percent: u8) {
    event::emit_install_progress(&InstallProgress {
        tool: tool.id().to_string(),
        stage: stage.to_string(),
        message: message.to_string(),
        percent,
    });
}

/// Install (or reinstall) a tool's managed binary, fetching the latest version
/// unless one is given. Emits `cli:install-progress` events as it runs.
pub async fn install(tool: Tool, version: Option<String>) -> Result<()> {
    paths::ensure_cli_dir(tool)?;
    let binary_path = paths::managed_binary_path(tool)
        .ok_or_else(|| AppError::Invalid("app data dir is not initialized".to_string()))?;

    let dist = dist::distribution(tool);

    emit_progress(tool, "starting", "Preparing installation…", 0);
    let version = match version {
        Some(v) => v,
        None => dist.latest_version().await?,
    };

    // The distribution emits the download/extract/verify stages it knows about.
    let binary = dist.fetch(&version).await?;

    emit_progress(
        tool,
        "installing",
        &format!("Installing {}…", tool.name()),
        70,
    );
    crate::platform::install::write_binary_file(&binary_path, &binary)?;

    emit_progress(tool, "verifying", "Verifying installation…", 90);
    if current_version(&binary_path).is_none() {
        return Err(AppError::Integration(format!(
            "{} did not run after install",
            tool.name()
        )));
    }

    emit_progress(tool, "complete", "Installation complete", 100);
    Ok(())
}

/// The latest published version string for a tool, via its distribution.
pub async fn latest_version(tool: Tool) -> Result<String> {
    dist::distribution(tool).latest_version().await
}

/// The version a binary reports via `--version` (digits-and-dots extracted).
pub fn current_version(path: &std::path::Path) -> Option<String> {
    let output = crate::platform::silent_command(&mut std::process::Command::new(path))
        .arg("--version")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    extract_version(text.trim())
}

/// Whether `latest` is a newer release than `current` by numeric comparison.
pub fn is_newer(current: &str, latest: &str) -> bool {
    parse_version(latest) > parse_version(current)
}

fn parse_version(version: &str) -> Vec<u32> {
    version
        .split(['.', '-'])
        .filter_map(|s| s.parse().ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions_numerically() {
        assert!(is_newer("1.2.3", "1.2.4"));
        assert!(is_newer("2.61.0", "2.62.0"));
        assert!(is_newer("0.116.0-alpha.11", "0.116.0-alpha.12"));
        assert!(!is_newer("1.2.3", "1.2.3"));
        assert!(!is_newer("1.3.0", "1.2.9"));
    }
}
