//! OpenCode CLI distribution: per-platform archives on GitHub releases. The repo
//! also ships desktop-app assets (`opencode-desktop-*`) and update manifests on
//! every release, so the matching-asset filter pins to the exact CLI name.

use crate::dist::{Asset, EntryMatcher, GithubReleaseDist, HostTarget, ReleaseStrategy};
use crate::error::Result;
use crate::net::host_binary_name;

/// The release asset carrying the CLI for the host platform.
fn asset_name(host: HostTarget) -> &'static str {
    match host {
        HostTarget::MacArm64 => "opencode-darwin-arm64.zip",
        HostTarget::MacX64 => "opencode-darwin-x64.zip",
        HostTarget::LinuxX64 => "opencode-linux-x64.tar.gz",
        HostTarget::LinuxArm64 => "opencode-linux-arm64.tar.gz",
        HostTarget::WindowsX64 => "opencode-windows-x64.zip",
        HostTarget::WindowsArm64 => "opencode-windows-arm64.zip",
    }
}

fn asset(host: HostTarget, _version: &str) -> Result<Asset> {
    let name = asset_name(host);
    Ok(Asset {
        name: name.to_string(),
        is_zip: name.ends_with(".zip"),
        entry: EntryMatcher::FileName(host_binary_name("opencode")),
    })
}

pub fn dist() -> GithubReleaseDist {
    GithubReleaseDist {
        tool: crate::cli::Tool::Opencode,
        owner: "anomalyco",
        repo: "opencode",
        download_label: "Downloading OpenCode CLI…",
        strategy: ReleaseStrategy::ListMatchingAsset { per_page: 20 },
        asset,
    }
}
