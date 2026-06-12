//! OpenCode CLI distribution: per-platform archives on GitHub releases. The
//! repo also ships desktop-app assets (`opencode-desktop-*`) and update
//! manifests on every release, so assets are matched by exact CLI name.

use std::path::Path;

use tauri::AppHandle;

use crate::cli::{self, archive, Tool};

const RELEASES_API: &str = "https://api.github.com/repos/anomalyco/opencode/releases";

/// The release asset carrying the CLI for the host platform.
fn asset_name() -> Result<&'static str, String> {
    Ok(match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "opencode-darwin-arm64.zip",
        ("macos", "x86_64") => "opencode-darwin-x64.zip",
        ("linux", "x86_64") => "opencode-linux-x64.tar.gz",
        ("linux", "aarch64") => "opencode-linux-arm64.tar.gz",
        ("windows", "x86_64") => "opencode-windows-x64.zip",
        ("windows", "aarch64") => "opencode-windows-arm64.zip",
        (os, arch) => return Err(format!("unsupported platform: {os}/{arch}")),
    })
}

/// Releases that ship the host's CLI asset, newest first.
async fn cli_releases() -> Result<Vec<archive::GitHubRelease>, String> {
    let asset = asset_name()?;
    Ok(archive::github_releases(RELEASES_API, 20)
        .await?
        .into_iter()
        .filter(|r| r.assets.iter().any(|a| a.name == asset))
        .collect())
}

pub async fn latest_version() -> Result<String, String> {
    let releases = cli_releases().await?;
    releases
        .iter()
        .find(|r| !r.prerelease)
        .or_else(|| releases.first())
        .map(|r| archive::version_from_tag(&r.tag_name))
        .ok_or_else(|| "no OpenCode release with a matching asset found".to_string())
}

pub async fn fetch(app: &AppHandle, version: &str) -> Result<Vec<u8>, String> {
    let asset_name = asset_name()?;
    let url = cli_releases()
        .await?
        .into_iter()
        .find(|r| archive::version_from_tag(&r.tag_name) == version)
        .and_then(|r| r.assets.into_iter().find(|a| a.name == asset_name))
        .map(|a| a.browser_download_url)
        .ok_or_else(|| format!("OpenCode asset {asset_name} not found"))?;

    cli::emit_progress(
        app,
        Tool::Opencode,
        "downloading",
        "Downloading OpenCode CLI…",
        20,
    );
    let archive_bytes = archive::download_bytes(&url).await?;
    cli::emit_progress(app, Tool::Opencode, "extracting", "Extracting archive…", 50);

    let entry = if cfg!(windows) {
        "opencode.exe"
    } else {
        "opencode"
    };
    let matches = move |p: &Path| p.file_name().and_then(|n| n.to_str()) == Some(entry);
    if asset_name.ends_with(".zip") {
        archive::extract_zip(&archive_bytes, matches)
    } else {
        archive::extract_tar_gz(&archive_bytes, matches)
    }
}
