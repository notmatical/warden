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

pub async fn latest_version() -> Result<String, String> {
    archive::github_releases(RELEASES_API, 20)
        .await?
        .into_iter()
        .find(|r| !r.assets.is_empty())
        .map(|r| archive::version_from_tag(&r.tag_name))
        .ok_or_else(|| "no Codex releases with assets found".to_string())
}

pub async fn fetch(app: &AppHandle, version: &str) -> Result<Vec<u8>, String> {
    let target = target()?;
    let (asset_name, is_zip) = if cfg!(windows) {
        (format!("codex-{target}.exe.zip"), true)
    } else {
        (format!("codex-{target}.tar.gz"), false)
    };
    let url = archive::github_releases(RELEASES_API, 20)
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
