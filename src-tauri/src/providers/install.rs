//! Downloads, verifies, and installs the managed provider CLI binaries. Claude
//! ships signed binaries from Anthropic's distribution bucket (SHA-256 verified
//! against a manifest); Codex ships per-target archives on GitHub releases.

use std::collections::HashMap;
use std::io::{Cursor, Read};

use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use super::manage::{self, write_binary_file};
use super::Provider;

const CLAUDE_DIST_BUCKET: &str = "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases";
const CODEX_RELEASES_API: &str = "https://api.github.com/repos/openai/codex/releases";
const USER_AGENT: &str = "warden-app";

type InstallResult = Result<(), String>;

/// Install (or reinstall) a provider's managed CLI, fetching the latest version
/// unless one is given. Emits `cli:install-progress` events as it goes.
pub async fn install(
    app: &AppHandle,
    provider: Provider,
    version: Option<String>,
) -> InstallResult {
    match provider {
        Provider::Claude => install_claude(app, version).await,
        Provider::Codex => install_codex(app, version).await,
    }
}

/// The latest published version string for a provider.
pub async fn latest_version(provider: Provider) -> Result<String, String> {
    match provider {
        Provider::Claude => claude_latest_version().await,
        Provider::Codex => codex_latest_version().await,
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
/// "claude 1.2.3 (Claude Code)" or "codex-cli 0.116.0-alpha.12".
fn extract_version(text: &str) -> Option<String> {
    text.split_whitespace()
        .find(|tok| {
            let t = tok.trim_start_matches('v');
            t.contains('.') && t.chars().next().is_some_and(|c| c.is_ascii_digit())
        })
        .map(|tok| tok.trim_start_matches('v').to_string())
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

/// The distribution bucket's platform token for the host.
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

async fn claude_latest_version() -> Result<String, String> {
    let url = format!("{CLAUDE_DIST_BUCKET}/latest");
    let text = http_client()?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("failed to fetch latest Claude version: {e}"))?
        .error_for_status()
        .map_err(|e| format!("failed to fetch latest Claude version: {e}"))?
        .text()
        .await
        .map_err(|e| format!("failed to read latest Claude version: {e}"))?;
    Ok(text.trim().to_string())
}

async fn install_claude(app: &AppHandle, version: Option<String>) -> InstallResult {
    manage::ensure_cli_dir(Provider::Claude)?;
    let binary_path =
        manage::managed_binary_path(Provider::Claude).ok_or("app data dir is not initialized")?;

    manage::emit_progress(
        app,
        Provider::Claude,
        "starting",
        "Preparing installation…",
        0,
    );
    let version = match version {
        Some(v) => v,
        None => claude_latest_version().await?,
    };
    let platform = claude_platform()?;

    manage::emit_progress(
        app,
        Provider::Claude,
        "fetching_manifest",
        "Fetching release manifest…",
        10,
    );
    let manifest_url = format!("{CLAUDE_DIST_BUCKET}/{version}/manifest.json");
    let manifest: Manifest = http_client()?
        .get(&manifest_url)
        .send()
        .await
        .map_err(|e| format!("failed to fetch manifest: {e}"))?
        .error_for_status()
        .map_err(|e| format!("failed to fetch manifest: {e}"))?
        .json()
        .await
        .map_err(|e| format!("failed to parse manifest: {e}"))?;
    let expected_checksum = manifest
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
    let download_url = format!("{CLAUDE_DIST_BUCKET}/{version}/{platform}/{binary_name}");

    manage::emit_progress(
        app,
        Provider::Claude,
        "downloading",
        "Downloading Claude CLI…",
        25,
    );
    let bytes = http_client()?
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("failed to download Claude CLI: {e}"))?
        .error_for_status()
        .map_err(|e| format!("failed to download Claude CLI: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("failed to read Claude CLI: {e}"))?;

    manage::emit_progress(
        app,
        Provider::Claude,
        "verifying",
        "Verifying checksum…",
        55,
    );
    verify_checksum(&bytes, &expected_checksum)?;

    manage::emit_progress(
        app,
        Provider::Claude,
        "installing",
        "Installing Claude CLI…",
        70,
    );
    write_binary_file(&binary_path, &bytes)?;
    strip_quarantine(&binary_path);

    manage::emit_progress(
        app,
        Provider::Claude,
        "complete",
        "Installation complete",
        100,
    );
    Ok(())
}

fn verify_checksum(data: &[u8], expected: &str) -> InstallResult {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let computed = format!("{:x}", hasher.finalize());
    if computed == expected.to_lowercase() {
        Ok(())
    } else {
        Err(format!(
            "checksum mismatch: expected {expected}, got {computed}"
        ))
    }
}

// ----- Codex (GitHub releases) ----------------------------------------------

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

/// GitHub's Rust-target token for the host.
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

async fn codex_releases() -> Result<Vec<GitHubRelease>, String> {
    http_client()?
        .get(format!("{CODEX_RELEASES_API}?per_page=20"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("failed to fetch Codex releases: {e}"))?
        .error_for_status()
        .map_err(|e| format!("failed to fetch Codex releases: {e}"))?
        .json()
        .await
        .map_err(|e| format!("failed to parse Codex releases: {e}"))
}

/// All Codex releases are prereleases, so the newest entry is "latest".
async fn codex_latest_version() -> Result<String, String> {
    let releases = codex_releases().await?;
    releases
        .into_iter()
        .find(|r| !r.assets.is_empty())
        .map(|r| version_from_tag(&r.tag_name))
        .ok_or_else(|| "no Codex releases with assets found".to_string())
}

async fn install_codex(app: &AppHandle, version: Option<String>) -> InstallResult {
    manage::ensure_cli_dir(Provider::Codex)?;
    let binary_path =
        manage::managed_binary_path(Provider::Codex).ok_or("app data dir is not initialized")?;

    manage::emit_progress(
        app,
        Provider::Codex,
        "starting",
        "Preparing installation…",
        0,
    );

    let target = codex_target()?;
    let (asset_name, is_zip) = if cfg!(windows) {
        (format!("codex-{target}.exe.zip"), true)
    } else {
        (format!("codex-{target}.tar.gz"), false)
    };

    let releases = codex_releases().await?;
    let release = match version {
        Some(ref v) => releases
            .iter()
            .find(|r| &version_from_tag(&r.tag_name) == v)
            .ok_or_else(|| format!("Codex release {v} not found"))?,
        None => releases
            .iter()
            .find(|r| !r.assets.is_empty())
            .ok_or("no Codex releases with assets found")?,
    };
    let download_url = release
        .assets
        .iter()
        .find(|a| a.name == asset_name)
        .map(|a| a.browser_download_url.clone())
        .ok_or_else(|| {
            format!(
                "asset {asset_name} not found in release {}",
                release.tag_name
            )
        })?;

    manage::emit_progress(
        app,
        Provider::Codex,
        "downloading",
        "Downloading Codex CLI…",
        20,
    );
    let archive = http_client()?
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("failed to download Codex CLI: {e}"))?
        .error_for_status()
        .map_err(|e| format!("failed to download Codex CLI: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("failed to read Codex CLI: {e}"))?;

    manage::emit_progress(
        app,
        Provider::Codex,
        "extracting",
        "Extracting archive…",
        50,
    );
    if is_zip {
        extract_zip(&archive, &binary_path, target)?;
    } else {
        extract_tar_gz(&archive, &binary_path, target)?;
    }
    strip_quarantine(&binary_path);

    manage::emit_progress(
        app,
        Provider::Codex,
        "verifying",
        "Verifying installation…",
        80,
    );
    let ok = crate::util::silent_command(&mut std::process::Command::new(&binary_path))
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !ok {
        return Err("Codex CLI verification failed (--version did not run)".to_string());
    }

    manage::emit_progress(
        app,
        Provider::Codex,
        "complete",
        "Installation complete",
        100,
    );
    Ok(())
}

/// Extract the main `codex-<target>` binary from the tar.gz, ignoring the helper
/// binaries (command-runner, sandbox-setup) bundled alongside it.
fn extract_tar_gz(archive: &[u8], binary_path: &std::path::Path, target: &str) -> InstallResult {
    use flate2::read::GzDecoder;
    use tar::Archive;

    let expected = format!("codex-{target}");
    let mut tar = Archive::new(GzDecoder::new(Cursor::new(archive)));
    for entry in tar
        .entries()
        .map_err(|e| format!("failed to read tar: {e}"))?
    {
        let mut entry = entry.map_err(|e| format!("failed to read tar entry: {e}"))?;
        let name = entry
            .path()
            .ok()
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()));
        if name.as_deref() == Some(expected.as_str()) {
            let mut content = Vec::new();
            entry
                .read_to_end(&mut content)
                .map_err(|e| format!("failed to read binary from archive: {e}"))?;
            return write_binary_file(binary_path, &content);
        }
    }
    Err(format!("'{expected}' not found in tar.gz archive"))
}

/// Extract the main `codex-<target>.exe` from the Windows zip.
fn extract_zip(archive: &[u8], binary_path: &std::path::Path, target: &str) -> InstallResult {
    let expected = format!("codex-{target}.exe");
    let mut zip = zip::ZipArchive::new(Cursor::new(archive))
        .map_err(|e| format!("failed to open zip: {e}"))?;
    for i in 0..zip.len() {
        let mut file = zip
            .by_index(i)
            .map_err(|e| format!("failed to read zip entry: {e}"))?;
        let name = file
            .enclosed_name()
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()));
        if name.as_deref() == Some(expected.as_str()) {
            let mut content = Vec::new();
            file.read_to_end(&mut content)
                .map_err(|e| format!("failed to read binary from archive: {e}"))?;
            return write_binary_file(binary_path, &content);
        }
    }
    Err(format!("'{expected}' not found in zip archive"))
}

// ----- shared ---------------------------------------------------------------

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))
}

/// Remove macOS's quarantine flag so a freshly downloaded binary can run.
fn strip_quarantine(path: &std::path::Path) {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("xattr")
            .args(["-d", "com.apple.quarantine"])
            .arg(path)
            .output();
    }
    #[cfg(not(target_os = "macos"))]
    let _ = path;
}
