//! Claude CLI distribution: Anthropic ships signed binaries from a Google Cloud
//! bucket, SHA-256 verified against a per-version manifest. Unlike the
//! GitHub-released tools, the version, URL, and checksum scheme are bespoke, so
//! this implements [`ToolDistribution`] directly rather than reusing
//! [`super::GithubReleaseDist`].

use std::collections::HashMap;

use serde::Deserialize;
use sha2::{Digest, Sha256};

use super::{emit_progress, HostTarget, ToolDistribution};
use crate::cli::Tool;
use crate::error::{AppError, Result};
use crate::net::{host_binary_name, http_client};

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
fn platform(host: HostTarget) -> Result<&'static str> {
    Ok(match host {
        HostTarget::MacArm64 => "darwin-arm64",
        HostTarget::MacX64 => "darwin-x64",
        HostTarget::LinuxX64 => "linux-x64",
        HostTarget::LinuxArm64 => "linux-arm64",
        HostTarget::WindowsX64 => "win32-x64",
        // The bucket ships no Windows-arm64 build.
        HostTarget::WindowsArm64 => {
            return Err(AppError::Integration(
                "unsupported platform: windows/aarch64".to_string(),
            ))
        }
    })
}

pub struct ClaudeDist;

#[async_trait::async_trait]
impl ToolDistribution for ClaudeDist {
    async fn latest_version(&self) -> Result<String> {
        let text = http_client()?
            .get(format!("{DIST_BUCKET}/latest"))
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| {
                AppError::Integration(format!("failed to fetch latest Claude version: {e}"))
            })?
            .text()
            .await
            .map_err(|e| {
                AppError::Integration(format!("failed to read latest Claude version: {e}"))
            })?;
        Ok(text.trim().to_string())
    }

    async fn fetch(&self, version: &str) -> Result<Vec<u8>> {
        let platform = platform(HostTarget::detect()?)?;

        emit_progress(
            Tool::Claude,
            "fetching_manifest",
            "Fetching release manifest…",
            10,
        );
        let manifest: Manifest = http_client()?
            .get(format!("{DIST_BUCKET}/{version}/manifest.json"))
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| AppError::Integration(format!("failed to fetch manifest: {e}")))?
            .json()
            .await
            .map_err(|e| AppError::Integration(format!("failed to parse manifest: {e}")))?;
        let expected = manifest
            .platforms
            .get(platform)
            .ok_or_else(|| AppError::Integration(format!("no checksum for platform {platform}")))?
            .checksum
            .clone();

        let binary_name = host_binary_name("claude");
        emit_progress(Tool::Claude, "downloading", "Downloading Claude CLI…", 25);
        let bytes = http_client()?
            .get(format!("{DIST_BUCKET}/{version}/{platform}/{binary_name}"))
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| AppError::Integration(format!("failed to download Claude CLI: {e}")))?
            .bytes()
            .await
            .map_err(|e| AppError::Integration(format!("failed to read Claude CLI: {e}")))?;

        emit_progress(Tool::Claude, "verifying", "Verifying checksum…", 55);
        let computed = format!("{:x}", Sha256::digest(&bytes));
        if computed != expected.to_lowercase() {
            return Err(AppError::Integration(format!(
                "checksum mismatch: expected {expected}, got {computed}"
            )));
        }
        Ok(bytes.to_vec())
    }
}
