//! Codex CLI distribution: per-target archives on GitHub releases. All Codex
//! releases are prereleases, so the newest release with the host asset is
//! "latest". The `openai/codex` repo also publishes unrelated streams
//! (`rusty-v8-*`, `codex-app-server-*`, …) that the matching-asset filter skips.

use crate::dist::{Asset, EntryMatcher, GithubReleaseDist, HostTarget, ReleaseStrategy};
use crate::error::Result;

/// GitHub's Rust-target token for the host.
fn target(host: HostTarget) -> &'static str {
    match host {
        HostTarget::MacArm64 => "aarch64-apple-darwin",
        HostTarget::MacX64 => "x86_64-apple-darwin",
        HostTarget::LinuxX64 => "x86_64-unknown-linux-gnu",
        HostTarget::LinuxArm64 => "aarch64-unknown-linux-gnu",
        HostTarget::WindowsX64 => "x86_64-pc-windows-msvc",
        HostTarget::WindowsArm64 => "aarch64-pc-windows-msvc",
    }
}

fn asset(host: HostTarget, _version: &str) -> Result<Asset> {
    let target = target(host);
    let is_zip = cfg!(windows);
    let (name, entry) = if is_zip {
        (
            format!("codex-{target}.exe.zip"),
            format!("codex-{target}.exe"),
        )
    } else {
        (format!("codex-{target}.tar.gz"), format!("codex-{target}"))
    };
    Ok(Asset {
        name,
        is_zip,
        entry: EntryMatcher::FileName(entry),
    })
}

pub fn dist() -> GithubReleaseDist {
    GithubReleaseDist {
        tool: crate::cli::Tool::Codex,
        owner: "openai",
        repo: "codex",
        download_label: "Downloading Codex CLI…",
        strategy: ReleaseStrategy::ListMatchingAsset { per_page: 40 },
        asset,
    }
}
