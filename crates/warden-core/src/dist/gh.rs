//! GitHub CLI distribution: per-target archives on GitHub releases. Stable tags
//! are `v{version}` and the asset URL is constructable from the version, so no
//! release listing is needed. The binary lives at `bin/gh` inside the archive.

use crate::dist::{Asset, EntryMatcher, GithubReleaseDist, HostTarget, ReleaseStrategy};
use crate::error::Result;
use crate::net::host_binary_name;

/// `(asset_name, is_zip)` for the GitHub CLI on the host.
fn asset_spec(host: HostTarget, version: &str) -> (String, bool) {
    match host {
        HostTarget::MacArm64 | HostTarget::MacX64 => {
            (format!("gh_{version}_macOS_universal.zip"), true)
        }
        HostTarget::LinuxX64 => (format!("gh_{version}_linux_amd64.tar.gz"), false),
        HostTarget::LinuxArm64 => (format!("gh_{version}_linux_arm64.tar.gz"), false),
        HostTarget::WindowsX64 => (format!("gh_{version}_windows_amd64.zip"), true),
        HostTarget::WindowsArm64 => (format!("gh_{version}_windows_arm64.zip"), true),
    }
}

fn asset(host: HostTarget, version: &str) -> Result<Asset> {
    let (name, is_zip) = asset_spec(host, version);
    Ok(Asset {
        name,
        is_zip,
        // The binary lives at `gh_<ver>_<os>_<arch>/bin/gh`; match by name under a bin dir.
        entry: EntryMatcher::FileNameUnder {
            name: host_binary_name("gh"),
            dir: "bin",
        },
    })
}

pub fn dist() -> GithubReleaseDist {
    GithubReleaseDist {
        tool: crate::cli::Tool::Gh,
        owner: "cli",
        repo: "cli",
        download_label: "Downloading GitHub CLI…",
        strategy: ReleaseStrategy::ConstructUrl { tag_prefix: "v" },
        asset,
    }
}
