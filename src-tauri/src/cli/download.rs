//! Where each managed tool's binary comes from, and how to turn a release into a
//! ready-to-write binary. Claude ships signed binaries from Anthropic's
//! distribution bucket (SHA-256 verified); Codex and the GitHub CLI ship
//! per-target archives on GitHub releases. GitHub requests carry the user's
//! token when one is available, which lifts the unauthenticated rate limit.

use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::path::Path;

use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use super::{install::emit_progress, Tool};

const CLAUDE_DIST_BUCKET: &str = "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases";
const CODEX_RELEASES_API: &str = "https://api.github.com/repos/openai/codex/releases";
const GH_RELEASES_API: &str = "https://api.github.com/repos/cli/cli/releases";
const USER_AGENT: &str = "warden-app";

/// Fetch and prepare the final binary bytes for a tool at `version`.
pub async fn fetch(app: &AppHandle, tool: Tool, version: &str) -> Result<Vec<u8>, String> {
    match tool {
        Tool::Claude => fetch_claude(app, version).await,
        Tool::Codex => fetch_codex(app, version).await,
        Tool::Gh => fetch_gh(app, version).await,
    }
}

/// The latest published version string for a tool.
pub async fn latest_version(tool: Tool) -> Result<String, String> {
    match tool {
        Tool::Claude => claude_latest().await,
        Tool::Codex => codex_latest().await,
        Tool::Gh => gh_latest().await,
    }
}

// ----- Claude (Anthropic distribution bucket) -------------------------------

#[derive(Debug, Deserialize)]
struct Manifest {
    platforms: HashMap<String, PlatformInfo>,
}

#[derive(Debug, Deserialize)]
struct PlatformInfo {
    checksum: String,
}

fn claude_platform() -> Result<&'static str, String> {
    Ok(match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "darwin-arm64",
        ("macos", "x86_64") => "darwin-x64",
        ("linux", "x86_64") => "linux-x64",
        ("linux", "aarch64") => "linux-arm64",
        ("windows", "x86_64") => "win32-x64",
        (os, arch) => return Err(format!("unsupported platform: {os}/{arch}")),
    })
}

async fn claude_latest() -> Result<String, String> {
    let text = http_client()?
        .get(format!("{CLAUDE_DIST_BUCKET}/latest"))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("failed to fetch latest Claude version: {e}"))?
        .text()
        .await
        .map_err(|e| format!("failed to read latest Claude version: {e}"))?;
    Ok(text.trim().to_string())
}

async fn fetch_claude(app: &AppHandle, version: &str) -> Result<Vec<u8>, String> {
    let platform = claude_platform()?;

    emit_progress(
        app,
        Tool::Claude,
        "fetching_manifest",
        "Fetching release manifest…",
        10,
    );
    let manifest: Manifest = http_client()?
        .get(format!("{CLAUDE_DIST_BUCKET}/{version}/manifest.json"))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("failed to fetch manifest: {e}"))?
        .json()
        .await
        .map_err(|e| format!("failed to parse manifest: {e}"))?;
    let expected = manifest
        .platforms
        .get(platform)
        .ok_or_else(|| format!("no checksum for platform {platform}"))?
        .checksum
        .clone();

    let binary_name = if cfg!(windows) {
        "claude.exe"
    } else {
        "claude"
    };
    emit_progress(
        app,
        Tool::Claude,
        "downloading",
        "Downloading Claude CLI…",
        25,
    );
    let bytes = http_client()?
        .get(format!(
            "{CLAUDE_DIST_BUCKET}/{version}/{platform}/{binary_name}"
        ))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("failed to download Claude CLI: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("failed to read Claude CLI: {e}"))?;

    emit_progress(app, Tool::Claude, "verifying", "Verifying checksum…", 55);
    let computed = format!("{:x}", Sha256::digest(&bytes));
    if computed != expected.to_lowercase() {
        return Err(format!(
            "checksum mismatch: expected {expected}, got {computed}"
        ));
    }
    Ok(bytes.to_vec())
}

// ----- GitHub releases (Codex, GitHub CLI) ----------------------------------

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    #[serde(default)]
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

/// Strip a release tag down to its semver (`rust-v0.1.2` / `v0.1.2` → `0.1.2`).
fn version_from_tag(tag: &str) -> String {
    for part in tag.split('v') {
        let trimmed = part.trim_end_matches('-');
        if trimmed.contains('.') && trimmed.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            return trimmed.to_string();
        }
    }
    tag.to_string()
}

async fn github_releases(api: &str, per_page: u32) -> Result<Vec<GitHubRelease>, String> {
    github_get(format!("{api}?per_page={per_page}"))?
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("failed to fetch releases: {e}"))?
        .json()
        .await
        .map_err(|e| format!("failed to parse releases: {e}"))
}

// Codex — all releases are prereleases, so the newest with assets is "latest".

fn codex_target() -> Result<&'static str, String> {
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

async fn codex_latest() -> Result<String, String> {
    github_releases(CODEX_RELEASES_API, 20)
        .await?
        .into_iter()
        .find(|r| !r.assets.is_empty())
        .map(|r| version_from_tag(&r.tag_name))
        .ok_or_else(|| "no Codex releases with assets found".to_string())
}

async fn fetch_codex(app: &AppHandle, version: &str) -> Result<Vec<u8>, String> {
    let target = codex_target()?;
    let (asset_name, is_zip) = if cfg!(windows) {
        (format!("codex-{target}.exe.zip"), true)
    } else {
        (format!("codex-{target}.tar.gz"), false)
    };
    let url = github_releases(CODEX_RELEASES_API, 20)
        .await?
        .into_iter()
        .find(|r| version_from_tag(&r.tag_name) == version)
        .and_then(|r| r.assets.into_iter().find(|a| a.name == asset_name))
        .map(|a| a.browser_download_url)
        .ok_or_else(|| format!("Codex asset {asset_name} not found"))?;

    emit_progress(
        app,
        Tool::Codex,
        "downloading",
        "Downloading Codex CLI…",
        20,
    );
    let archive = download_bytes(&url).await?;
    emit_progress(app, Tool::Codex, "extracting", "Extracting archive…", 50);

    let entry = if cfg!(windows) {
        format!("codex-{target}.exe")
    } else {
        format!("codex-{target}")
    };
    let matches = move |p: &Path| p.file_name().and_then(|n| n.to_str()) == Some(entry.as_str());
    if is_zip {
        extract_zip(&archive, matches)
    } else {
        extract_tar_gz(&archive, matches)
    }
}

// GitHub CLI — stable releases, tags are `v{version}`, binary lives at `bin/gh`.

/// `(asset_name, is_zip)` for the GitHub CLI on the current host.
fn gh_asset(version: &str) -> Result<(String, bool), String> {
    Ok(match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", _) => (format!("gh_{version}_macOS_universal.zip"), true),
        ("linux", "x86_64") => (format!("gh_{version}_linux_amd64.tar.gz"), false),
        ("linux", "aarch64") => (format!("gh_{version}_linux_arm64.tar.gz"), false),
        ("windows", "x86_64") => (format!("gh_{version}_windows_amd64.zip"), true),
        ("windows", "aarch64") => (format!("gh_{version}_windows_arm64.zip"), true),
        (os, arch) => return Err(format!("unsupported platform: {os}/{arch}")),
    })
}

async fn gh_latest() -> Result<String, String> {
    let release: GitHubRelease = github_get(format!("{GH_RELEASES_API}/latest"))?
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("failed to fetch latest gh release: {e}"))?
        .json()
        .await
        .map_err(|e| format!("failed to parse latest gh release: {e}"))?;
    Ok(version_from_tag(&release.tag_name))
}

async fn fetch_gh(app: &AppHandle, version: &str) -> Result<Vec<u8>, String> {
    let (asset, is_zip) = gh_asset(version)?;
    // gh tags are `v{version}`, so the asset URL is constructable without an API call.
    let url = format!("https://github.com/cli/cli/releases/download/v{version}/{asset}");

    emit_progress(app, Tool::Gh, "downloading", "Downloading GitHub CLI…", 20);
    let archive = download_bytes(&url).await?;
    emit_progress(app, Tool::Gh, "extracting", "Extracting archive…", 50);

    let bin_name = if cfg!(windows) { "gh.exe" } else { "gh" };
    // The binary lives at `gh_<ver>_<os>_<arch>/bin/gh`; match by name under a bin dir.
    let matches = move |p: &Path| {
        p.file_name().and_then(|n| n.to_str()) == Some(bin_name)
            && p.components().any(|c| c.as_os_str() == "bin")
    };
    if is_zip {
        extract_zip(&archive, matches)
    } else {
        extract_tar_gz(&archive, matches)
    }
}

// ----- archive extraction ---------------------------------------------------

fn extract_tar_gz(archive: &[u8], matches: impl Fn(&Path) -> bool) -> Result<Vec<u8>, String> {
    use flate2::read::GzDecoder;
    use tar::Archive;

    let mut tar = Archive::new(GzDecoder::new(Cursor::new(archive)));
    for entry in tar
        .entries()
        .map_err(|e| format!("failed to read tar: {e}"))?
    {
        let mut entry = entry.map_err(|e| format!("failed to read tar entry: {e}"))?;
        let path = entry
            .path()
            .map_err(|e| format!("failed to read tar path: {e}"))?
            .into_owned();
        if matches(&path) {
            let mut content = Vec::new();
            entry
                .read_to_end(&mut content)
                .map_err(|e| format!("failed to read binary from archive: {e}"))?;
            return Ok(content);
        }
    }
    Err("binary not found in tar.gz archive".to_string())
}

fn extract_zip(archive: &[u8], matches: impl Fn(&Path) -> bool) -> Result<Vec<u8>, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(archive))
        .map_err(|e| format!("failed to open zip: {e}"))?;
    for i in 0..zip.len() {
        let mut file = zip
            .by_index(i)
            .map_err(|e| format!("failed to read zip entry: {e}"))?;
        let matched = file.enclosed_name().map(|p| matches(&p)).unwrap_or(false);
        if matched {
            let mut content = Vec::new();
            file.read_to_end(&mut content)
                .map_err(|e| format!("failed to read binary from archive: {e}"))?;
            return Ok(content);
        }
    }
    Err("binary not found in zip archive".to_string())
}

// ----- HTTP -----------------------------------------------------------------

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))
}

/// A GitHub API request carrying the JSON headers and the user's token if known.
fn github_get(url: String) -> Result<reqwest::RequestBuilder, String> {
    let mut req = http_client()?
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(token) = crate::github::resolve_token() {
        req = req.bearer_auth(token);
    }
    Ok(req)
}

async fn download_bytes(url: &str) -> Result<Vec<u8>, String> {
    let bytes = http_client()?
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("download failed: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("failed to read download: {e}"))?;
    Ok(bytes.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_release_tags_to_semver() {
        assert_eq!(version_from_tag("v2.62.0"), "2.62.0");
        assert_eq!(
            version_from_tag("rust-v0.116.0-alpha.12"),
            "0.116.0-alpha.12"
        );
    }
}
