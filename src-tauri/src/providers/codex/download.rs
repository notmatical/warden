//! Codex CLI distribution: per-target archives on GitHub releases. All Codex
//! releases are prereleases, so the newest release with assets is "latest".

use std::path::Path;

use tauri::AppHandle;

use crate::cli::{self, archive, Tool};

const RELEASES_API: &str = "https://api.github.com/repos/openai/codex/releases";

/// GitHub's Rust-target token for the host.
fn target() -> Result<&'static str, String> {
    Ok(match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "aarch64-apple-darwin",
        ("macos", "x86_64") => "x86_64-apple-darwin",
        ("linux", "x86_64") => "x86_64-unknown-linux-gnu",
        ("linux", "aarch64") => "aarch64-unknown-linux-gnu",
        ("windows", "x86_64") => "x86_64-pc-windows-msvc",
        ("windows", "aarch64") => "aarch64-pc-windows-msvc",
        (os, arch) => return Err(format!("unsupported platform: {os}/{arch}")),
    })
}

/// The release asset carrying the CLI for the host target.
fn asset_name() -> Result<String, String> {
    let target = target()?;
    Ok(if cfg!(windows) {
        format!("codex-{target}.exe.zip")
    } else {
        format!("codex-{target}.tar.gz")
    })
}

/// Releases that actually ship the host's Codex CLI asset, newest first. The
/// `openai/codex` repo also publishes unrelated streams (`rusty-v8-*`,
/// `codex-app-server-*`, …) that must be skipped — otherwise "latest" lands on a
/// release with no CLI binary.
async fn cli_releases() -> Result<Vec<archive::GitHubRelease>, String> {
    let asset = asset_name()?;
    Ok(archive::github_releases(RELEASES_API, 40)
        .await?
        .into_iter()
        .filter(|r| r.assets.iter().any(|a| a.name == asset))
        .collect())
}

pub async fn latest_version() -> Result<String, String> {
    let releases = cli_releases().await?;
    // Prefer the newest stable; fall back to the newest prerelease (Codex ships
    // long alpha streams, so a stable isn't always available).
    releases
        .iter()
        .find(|r| !r.prerelease)
        .or_else(|| releases.first())
        .map(|r| archive::version_from_tag(&r.tag_name))
        .ok_or_else(|| "no Codex CLI release with a matching asset found".to_string())
}

pub async fn fetch(app: &AppHandle, version: &str) -> Result<Vec<u8>, String> {
    let target = target()?;
    let asset_name = asset_name()?;
    let is_zip = cfg!(windows);
    let url = cli_releases()
        .await?
        .into_iter()
        .find(|r| archive::version_from_tag(&r.tag_name) == version)
        .and_then(|r| r.assets.into_iter().find(|a| a.name == asset_name))
        .map(|a| a.browser_download_url)
        .ok_or_else(|| format!("Codex asset {asset_name} not found"))?;

    cli::emit_progress(
        app,
        Tool::Codex,
        "downloading",
        "Downloading Codex CLI…",
        20,
    );
    let archive_bytes = archive::download_bytes(&url).await?;
    cli::emit_progress(app, Tool::Codex, "extracting", "Extracting archive…", 50);

    let entry = if cfg!(windows) {
        format!("codex-{target}.exe")
    } else {
        format!("codex-{target}")
    };
    let matches = move |p: &Path| p.file_name().and_then(|n| n.to_str()) == Some(entry.as_str());
    if is_zip {
        archive::extract_zip(&archive_bytes, matches)
    } else {
        archive::extract_tar_gz(&archive_bytes, matches)
    }
}
