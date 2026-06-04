//! Claude CLI distribution: Anthropic ships signed binaries from a Google Cloud
//! bucket, SHA-256 verified against a per-version manifest.

use std::collections::HashMap;

use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::cli::{self, archive, Tool};

const DIST_BUCKET: &str = "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases";

#[derive(Debug, Deserialize)]
struct Manifest {
    platforms: HashMap<String, PlatformInfo>,
}

#[derive(Debug, Deserialize)]
struct PlatformInfo {
    checksum: String,
}

/// The distribution bucket's platform token for the host.
fn platform() -> Result<&'static str, String> {
    Ok(match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "darwin-arm64",
        ("macos", "x86_64") => "darwin-x64",
        ("linux", "x86_64") => "linux-x64",
        ("linux", "aarch64") => "linux-arm64",
        ("windows", "x86_64") => "win32-x64",
        (os, arch) => return Err(format!("unsupported platform: {os}/{arch}")),
    })
}

pub async fn latest_version() -> Result<String, String> {
    let text = archive::http_client()?
        .get(format!("{DIST_BUCKET}/latest"))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("failed to fetch latest Claude version: {e}"))?
        .text()
        .await
        .map_err(|e| format!("failed to read latest Claude version: {e}"))?;
    Ok(text.trim().to_string())
}

/// Download the verified Claude binary bytes for `version`.
pub async fn fetch(app: &AppHandle, version: &str) -> Result<Vec<u8>, String> {
    let platform = platform()?;

    cli::emit_progress(
        app,
        Tool::Claude,
        "fetching_manifest",
        "Fetching release manifest…",
        10,
    );
    let manifest: Manifest = archive::http_client()?
        .get(format!("{DIST_BUCKET}/{version}/manifest.json"))
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
    cli::emit_progress(
        app,
        Tool::Claude,
        "downloading",
        "Downloading Claude CLI…",
        25,
    );
    let bytes = archive::http_client()?
        .get(format!("{DIST_BUCKET}/{version}/{platform}/{binary_name}"))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("failed to download Claude CLI: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("failed to read Claude CLI: {e}"))?;

    cli::emit_progress(app, Tool::Claude, "verifying", "Verifying checksum…", 55);
    let computed = format!("{:x}", Sha256::digest(&bytes));
    if computed != expected.to_lowercase() {
        return Err(format!(
            "checksum mismatch: expected {expected}, got {computed}"
        ));
    }
    Ok(bytes.to_vec())
}
