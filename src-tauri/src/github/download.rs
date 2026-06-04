//! GitHub CLI distribution: per-target archives on GitHub releases. Stable tags
//! are `v{version}`, and the binary lives at `bin/gh` inside the archive.

use std::path::Path;

use tauri::AppHandle;

use crate::cli::{self, archive, Tool};

const RELEASES_API: &str = "https://api.github.com/repos/cli/cli/releases";

/// `(asset_name, is_zip)` for the GitHub CLI on the current host.
fn asset(version: &str) -> Result<(String, bool), String> {
    Ok(match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", _) => (format!("gh_{version}_macOS_universal.zip"), true),
        ("linux", "x86_64") => (format!("gh_{version}_linux_amd64.tar.gz"), false),
        ("linux", "aarch64") => (format!("gh_{version}_linux_arm64.tar.gz"), false),
        ("windows", "x86_64") => (format!("gh_{version}_windows_amd64.zip"), true),
        ("windows", "aarch64") => (format!("gh_{version}_windows_arm64.zip"), true),
        (os, arch) => return Err(format!("unsupported platform: {os}/{arch}")),
    })
}

pub async fn latest_version() -> Result<String, String> {
    let release: archive::GitHubRelease = archive::github_get(format!("{RELEASES_API}/latest"))?
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("failed to fetch latest gh release: {e}"))?
        .json()
        .await
        .map_err(|e| format!("failed to parse latest gh release: {e}"))?;
    Ok(archive::version_from_tag(&release.tag_name))
}

pub async fn fetch(app: &AppHandle, version: &str) -> Result<Vec<u8>, String> {
    let (asset, is_zip) = asset(version)?;
    // gh tags are `v{version}`, so the asset URL is constructable without an API call.
    let url = format!("https://github.com/cli/cli/releases/download/v{version}/{asset}");

    cli::emit_progress(app, Tool::Gh, "downloading", "Downloading GitHub CLI…", 20);
    let archive_bytes = archive::download_bytes(&url).await?;
    cli::emit_progress(app, Tool::Gh, "extracting", "Extracting archive…", 50);

    let bin_name = if cfg!(windows) { "gh.exe" } else { "gh" };
    // The binary lives at `gh_<ver>_<os>_<arch>/bin/gh`; match by name under a bin dir.
    let matches = move |p: &Path| {
        p.file_name().and_then(|n| n.to_str()) == Some(bin_name)
            && p.components().any(|c| c.as_os_str() == "bin")
    };
    if is_zip {
        archive::extract_zip(&archive_bytes, matches)
    } else {
        archive::extract_tar_gz(&archive_bytes, matches)
    }
}
