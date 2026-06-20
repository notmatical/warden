//! Managed-tool distribution: how warden discovers the latest version of a CLI
//! and fetches its host binary. Each tool is a [`ToolDistribution`]; install
//! orchestration ([`crate::cli::install`]) drives the trait and never reaches
//! into a tool's specifics. Most tools are a [`GithubReleaseDist`] value — only
//! the owner/repo and asset naming differ; Claude is the exception (a GCS bucket
//! with a verified manifest) and implements the trait directly.

mod claude;
mod codex;
mod gh;
mod opencode;

use std::path::Path;

use crate::cli::Tool;
use crate::error::{AppError, Result};
use crate::event::{self, payloads::InstallProgress};
use crate::net::{self, version::version_from_tag, GitHubRelease};

/// A supported host (OS × CPU). Detection lives in [`HostTarget::detect`] so the
/// "unsupported platform" error is produced in exactly one place; each
/// distribution maps a target onto its own asset-naming scheme.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostTarget {
    MacArm64,
    MacX64,
    LinuxX64,
    LinuxArm64,
    WindowsX64,
    WindowsArm64,
}

impl HostTarget {
    /// The current host, or an "unsupported platform" error.
    pub fn detect() -> Result<Self> {
        Ok(match (std::env::consts::OS, std::env::consts::ARCH) {
            ("macos", "aarch64") => HostTarget::MacArm64,
            ("macos", "x86_64") => HostTarget::MacX64,
            ("linux", "x86_64") => HostTarget::LinuxX64,
            ("linux", "aarch64") => HostTarget::LinuxArm64,
            ("windows", "x86_64") => HostTarget::WindowsX64,
            ("windows", "aarch64") => HostTarget::WindowsArm64,
            (os, arch) => {
                return Err(AppError::Integration(format!(
                    "unsupported platform: {os}/{arch}"
                )))
            }
        })
    }
}

/// A managed tool's distribution: where its versions and binaries come from.
/// `fetch` emits the per-stage download/extract/verify progress it knows about.
#[async_trait::async_trait]
pub trait ToolDistribution: Send + Sync {
    /// The latest published version string.
    async fn latest_version(&self) -> Result<String>;
    /// The verified, extracted host binary bytes for `version`.
    async fn fetch(&self, version: &str) -> Result<Vec<u8>>;
}

/// The distribution for a tool — the single dispatch point install goes through.
pub fn distribution(tool: Tool) -> Box<dyn ToolDistribution> {
    match tool {
        Tool::Claude => Box::new(claude::ClaudeDist),
        Tool::Codex => Box::new(codex::dist()),
        Tool::Opencode => Box::new(opencode::dist()),
        Tool::Gh => Box::new(gh::dist()),
    }
}

/// How the host binary is located inside a release archive.
#[derive(Debug, Clone)]
pub enum EntryMatcher {
    /// The archive entry whose file name is exactly this.
    FileName(String),
    /// The entry named `name` sitting under a directory component `dir`
    /// (e.g. `gh` under `bin/`).
    FileNameUnder { name: String, dir: &'static str },
}

impl EntryMatcher {
    fn matches(&self, path: &Path) -> bool {
        match self {
            EntryMatcher::FileName(name) => {
                path.file_name().and_then(|n| n.to_str()) == Some(name.as_str())
            }
            EntryMatcher::FileNameUnder { name, dir } => {
                path.file_name().and_then(|n| n.to_str()) == Some(name.as_str())
                    && path.components().any(|c| c.as_os_str() == *dir)
            }
        }
    }
}

/// A resolved release asset: its file name, archive format, and the entry to
/// pull out of it.
pub struct Asset {
    pub name: String,
    pub is_zip: bool,
    pub entry: EntryMatcher,
}

/// How a GitHub-released tool resolves its version and download URL.
pub enum ReleaseStrategy {
    /// List releases and keep those carrying the host asset (repos that publish
    /// unrelated streams or desktop-app assets need this filter). `per_page`
    /// bounds the listing window.
    ListMatchingAsset { per_page: u32 },
    /// The asset URL is constructable from the version, so `latest` comes from
    /// the `/releases/latest` endpoint and `fetch` builds the URL directly.
    /// `tag_prefix` is prepended to the version to form the release tag.
    ConstructUrl { tag_prefix: &'static str },
}

/// A managed tool distributed as host-specific assets on GitHub releases. The
/// owner/repo, version-resolution strategy, and a host→asset mapping are all that
/// differ between the GitHub-based tools.
pub struct GithubReleaseDist {
    pub tool: Tool,
    pub owner: &'static str,
    pub repo: &'static str,
    /// Message shown for the download stage (e.g. "Downloading Codex CLI…").
    pub download_label: &'static str,
    pub strategy: ReleaseStrategy,
    /// Host + version → the asset to download and the entry to extract.
    pub asset: fn(HostTarget, &str) -> Result<Asset>,
}

impl GithubReleaseDist {
    /// Releases carrying the host's asset, newest first.
    async fn matching_releases(&self, asset_name: &str) -> Result<Vec<GitHubRelease>> {
        let per_page = match self.strategy {
            ReleaseStrategy::ListMatchingAsset { per_page } => per_page,
            // Not used by the construct-URL strategy.
            ReleaseStrategy::ConstructUrl { .. } => 1,
        };
        Ok(net::github_releases(self.owner, self.repo, per_page, None)
            .await?
            .into_iter()
            .filter(|r| r.assets.iter().any(|a| a.name == asset_name))
            .collect())
    }
}

#[async_trait::async_trait]
impl ToolDistribution for GithubReleaseDist {
    async fn latest_version(&self) -> Result<String> {
        match self.strategy {
            ReleaseStrategy::ListMatchingAsset { .. } => {
                // Asset name can't depend on the unknown latest version here; the
                // list strategy's tools never embed the version in the asset name.
                let asset = (self.asset)(HostTarget::detect()?, "").map(|a| a.name)?;
                let releases = self.matching_releases(&asset).await?;
                // Prefer the newest stable; fall back to the newest prerelease
                // (some repos ship long alpha streams with no current stable).
                releases
                    .iter()
                    .find(|r| !r.prerelease)
                    .or_else(|| releases.first())
                    .map(|r| version_from_tag(&r.tag_name))
                    .ok_or_else(|| {
                        AppError::Integration(format!(
                            "no {} release with a matching asset found",
                            self.tool.name()
                        ))
                    })
            }
            ReleaseStrategy::ConstructUrl { .. } => {
                let url = format!(
                    "https://api.github.com/repos/{}/{}/releases/latest",
                    self.owner, self.repo
                );
                let release: GitHubRelease = net::github_get(url, None)?
                    .send()
                    .await
                    .and_then(|r| r.error_for_status())
                    .map_err(|e| {
                        AppError::Integration(format!(
                            "failed to fetch latest {} release: {e}",
                            self.tool.name()
                        ))
                    })?
                    .json()
                    .await
                    .map_err(|e| {
                        AppError::Integration(format!(
                            "failed to parse latest {} release: {e}",
                            self.tool.name()
                        ))
                    })?;
                Ok(version_from_tag(&release.tag_name))
            }
        }
    }

    async fn fetch(&self, version: &str) -> Result<Vec<u8>> {
        let target = HostTarget::detect()?;
        let asset = (self.asset)(target, version)?;

        let url = match self.strategy {
            ReleaseStrategy::ListMatchingAsset { .. } => self
                .matching_releases(&asset.name)
                .await?
                .into_iter()
                .find(|r| version_from_tag(&r.tag_name) == version)
                .and_then(|r| {
                    r.assets
                        .into_iter()
                        .find(|a| a.name == asset.name)
                        .map(|a| a.browser_download_url)
                })
                .ok_or_else(|| {
                    AppError::Integration(format!("{} asset {} not found", self.tool.name(), asset.name))
                })?,
            ReleaseStrategy::ConstructUrl { tag_prefix } => format!(
                "https://github.com/{}/{}/releases/download/{tag_prefix}{version}/{}",
                self.owner, self.repo, asset.name
            ),
        };

        emit_progress(self.tool, "downloading", self.download_label, 20);
        let bytes = net::download_bytes(&url).await?;
        emit_progress(self.tool, "extracting", "Extracting archive…", 50);

        net::extract(&bytes, asset.is_zip, |p| asset.entry.matches(p))
    }
}

/// Emit an install-progress event for a distribution stage.
pub(crate) fn emit_progress(tool: Tool, stage: &str, message: &str, percent: u8) {
    event::emit_install_progress(&InstallProgress {
        tool: tool.id().to_string(),
        stage: stage.to_string(),
        message: message.to_string(),
        percent,
    });
}
