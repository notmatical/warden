//! Install orchestration shared by every managed tool: emit progress, write the
//! downloaded binary atomically, make it runnable, and verify it. The bytes and
//! latest-version lookup for a given tool come from that tool's own module (see
//! [`fetch`] / [`latest_version`]).

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::{paths, Tool};

/// Progress payload emitted to the frontend during an install.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub tool: String,
    pub stage: String,
    pub message: String,
    pub percent: u8,
}

/// Emit an install-progress event to the frontend.
pub fn emit_progress(app: &AppHandle, tool: Tool, stage: &str, message: &str, percent: u8) {
    let _ = app.emit(
        "cli:install-progress",
        InstallProgress {
            tool: tool.id().to_string(),
            stage: stage.to_string(),
            message: message.to_string(),
            percent,
        },
    );
}

/// Install (or reinstall) a tool's managed binary, fetching the latest version
/// unless one is given. Emits `cli:install-progress` events as it runs.
pub async fn install(app: &AppHandle, tool: Tool, version: Option<String>) -> Result<(), String> {
    paths::ensure_cli_dir(tool)?;
    let binary_path = paths::managed_binary_path(tool).ok_or("app data dir is not initialized")?;

    emit_progress(app, tool, "starting", "Preparing installation…", 0);
    let version = match version {
        Some(v) => v,
        None => latest_version(tool).await?,
    };

    // The tool's own module emits the download/extract/verify stages it knows about.
    let binary = fetch(app, tool, &version).await?;

    emit_progress(
        app,
        tool,
        "installing",
        &format!("Installing {}…", tool.name()),
        70,
    );
    write_binary_file(&binary_path, &binary)?;
    make_runnable(&binary_path);

    emit_progress(app, tool, "verifying", "Verifying installation…", 90);
    if current_version(&binary_path).is_none() {
        return Err(format!("{} did not run after install", tool.name()));
    }

    emit_progress(app, tool, "complete", "Installation complete", 100);
    Ok(())
}

/// Download (and verify/extract) a tool's binary, dispatching to its module.
async fn fetch(app: &AppHandle, tool: Tool, version: &str) -> Result<Vec<u8>, String> {
    match tool {
        Tool::Claude => crate::providers::claude::download::fetch(app, version).await,
        Tool::Codex => crate::providers::codex::download::fetch(app, version).await,
        Tool::Gh => crate::github::download::fetch(app, version).await,
    }
}

/// The latest published version string for a tool, dispatching to its module.
pub async fn latest_version(tool: Tool) -> Result<String, String> {
    match tool {
        Tool::Claude => crate::providers::claude::download::latest_version().await,
        Tool::Codex => crate::providers::codex::download::latest_version().await,
        Tool::Gh => crate::github::download::latest_version().await,
    }
}

/// The version a binary reports via `--version` (digits-and-dots extracted).
pub fn current_version(path: &std::path::Path) -> Option<String> {
    let output = crate::util::silent_command(&mut std::process::Command::new(path))
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
        .split(|c: char| c == '.' || c == '-')
        .filter_map(|s| s.parse().ok())
        .collect()
}

/// Pull the first `digits.digits…` run out of a `--version` line such as
/// "claude 1.2.3 (Claude Code)", "codex-cli 0.116.0-alpha.12", or "gh version 2.62.0".
fn extract_version(text: &str) -> Option<String> {
    text.split_whitespace()
        .find(|tok| {
            let t = tok.trim_start_matches('v');
            t.contains('.') && t.chars().next().is_some_and(|c| c.is_ascii_digit())
        })
        .map(|tok| tok.trim_start_matches('v').to_string())
}

/// Write a downloaded binary to `path` via a temp file + atomic rename. On
/// Windows a running binary holds a lock, so the existing file is moved aside
/// first; elsewhere the rename swaps the directory entry to the new inode.
pub fn write_binary_file(path: &std::path::Path, content: &[u8]) -> Result<(), String> {
    let temp_path = path.with_extension("tmp");
    std::fs::write(&temp_path, content).map_err(|e| format!("failed to write temp file: {e}"))?;

    #[cfg(windows)]
    {
        let old_path = path.with_extension("old");
        if path.exists() {
            let _ = std::fs::remove_file(&old_path);
            if let Err(e) = std::fs::rename(path, &old_path) {
                let _ = std::fs::remove_file(&temp_path);
                return Err(format!("failed to replace existing binary: {e}"));
            }
        }
        if let Err(e) = std::fs::rename(&temp_path, path) {
            let _ = std::fs::rename(&old_path, path);
            return Err(format!("failed to install new binary: {e}"));
        }
        let _ = std::fs::remove_file(&old_path);
    }

    #[cfg(not(windows))]
    if let Err(e) = std::fs::rename(&temp_path, path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!("failed to install new binary: {e}"));
    }

    Ok(())
}

/// Make a freshly written binary executable (Unix) and clear macOS quarantine.
fn make_runnable(path: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(path, perms);
        }
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("xattr")
            .args(["-d", "com.apple.quarantine"])
            .arg(path)
            .output();
    }
    #[cfg(not(any(unix, target_os = "macos")))]
    let _ = path;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_version_from_cli_output() {
        assert_eq!(
            extract_version("claude 1.2.3 (Claude Code)").as_deref(),
            Some("1.2.3")
        );
        assert_eq!(
            extract_version("codex-cli 0.116.0-alpha.12").as_deref(),
            Some("0.116.0-alpha.12")
        );
        assert_eq!(
            extract_version("gh version 2.62.0 (2024-11-14)").as_deref(),
            Some("2.62.0")
        );
        assert_eq!(extract_version("no version here"), None);
    }

    #[test]
    fn compares_versions_numerically() {
        assert!(is_newer("1.2.3", "1.2.4"));
        assert!(is_newer("2.61.0", "2.62.0"));
        assert!(is_newer("0.116.0-alpha.11", "0.116.0-alpha.12"));
        assert!(!is_newer("1.2.3", "1.2.3"));
        assert!(!is_newer("1.3.0", "1.2.9"));
    }
}
