//! Managed command-line tools warden can install into its app data and run, or
//! defer to the system PATH copy. The agent providers (Claude, Codex, OpenCode)
//! and the GitHub CLI are all [`Tool`]s; this module is the tool-agnostic
//! machinery (paths, source preference, install, status) they share. The actual
//! download/extract logic lives behind [`crate::dist::ToolDistribution`].
//! Grok installs via npm into the managed CLI dir; Cursor runs its own vendor
//! installer, which places the binary on the system PATH.

pub mod install;
mod paths;
mod source;

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use specta::Type;

pub use crate::dist::Installed;
pub use install::{current_version, emit_progress, install, is_newer, latest_version};
pub use paths::{cli_dir, managed_binary_path, managed_installed, resolve, system_binary};
pub use source::{set_source, source, Source};

/// A managed CLI warden knows how to install and run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Tool {
    Claude,
    Codex,
    Opencode,
    Cursor,
    Grok,
    Gh,
}

impl Tool {
    pub const ALL: [Tool; 6] = [
        Tool::Claude,
        Tool::Codex,
        Tool::Opencode,
        Tool::Cursor,
        Tool::Grok,
        Tool::Gh,
    ];

    /// Stable id used on the IPC boundary and for settings keys.
    pub fn id(self) -> &'static str {
        match self {
            Tool::Claude => "claude",
            Tool::Codex => "codex",
            Tool::Opencode => "opencode",
            Tool::Cursor => "cursor",
            Tool::Grok => "grok",
            Tool::Gh => "gh",
        }
    }

    /// Human-readable name.
    pub fn name(self) -> &'static str {
        match self {
            Tool::Claude => "Claude",
            Tool::Codex => "Codex",
            Tool::Opencode => "OpenCode",
            Tool::Cursor => "Cursor",
            Tool::Grok => "Grok",
            Tool::Gh => "GitHub CLI",
        }
    }

    /// Binary name resolved on PATH (no extension). Cursor ships its CLI as
    /// `cursor-agent` (the canonical, unambiguous name — a bare `agent` would
    /// collide with unrelated tools); Grok's npm package installs `grok`.
    pub fn bin(self) -> &'static str {
        match self {
            Tool::Claude => "claude",
            Tool::Codex => "codex",
            Tool::Opencode => "opencode",
            Tool::Cursor => "cursor-agent",
            Tool::Grok => "grok",
            Tool::Gh => "gh",
        }
    }

    /// Subdirectory under the app data dir that holds the managed binary.
    pub fn cli_dir_name(self) -> &'static str {
        match self {
            Tool::Claude => "claude-cli",
            Tool::Codex => "codex-cli",
            Tool::Opencode => "opencode-cli",
            Tool::Cursor => "cursor-cli",
            Tool::Grok => "grok-cli",
            Tool::Gh => "gh-cli",
        }
    }
}

/// Record warden's app data dir (must run before any managed-path lookup).
pub fn set_app_data(app_data_dir: PathBuf) {
    paths::set_app_data(app_data_dir);
}

/// Seed the per-tool source preferences at startup.
pub fn set_sources(sources: HashMap<Tool, Source>) {
    source::set_all(sources);
}

/// A tool's install/version/auth snapshot, surfaced to the UI. `authed` and the
/// latest-version fields are filled by the owning domain (see [`base_status`] and
/// [`fill_latest`]).
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub id: String,
    pub name: String,
    /// User's source preference: `auto` | `managed` | `system`.
    pub source: String,
    /// Whether the effective (resolved) binary is present and runnable.
    pub installed: bool,
    pub version: Option<String>,
    /// Absolute path of the effective binary.
    pub path: Option<String>,
    pub authed: bool,
    pub system_detected: bool,
    pub managed_installed: bool,
    pub managed_version: Option<String>,
    pub latest_version: Option<String>,
    pub update_available: bool,
}

/// The synchronous half of a tool's status: resolved binary, versions, source.
/// `authed` defaults false; callers set it. Latest-version is filled separately.
pub fn base_status(tool: Tool) -> ToolStatus {
    let resolved = resolve(tool);
    let version = current_version(&resolved);
    let managed = managed_installed(tool);
    let managed_version = managed.as_deref().and_then(current_version);

    ToolStatus {
        id: tool.id().to_string(),
        name: tool.name().to_string(),
        source: source(tool).as_str().to_string(),
        installed: version.is_some(),
        version,
        path: Some(resolved.to_string_lossy().to_string()),
        authed: false,
        system_detected: system_binary(tool).is_some(),
        managed_installed: managed.is_some(),
        managed_version,
        latest_version: None,
        update_available: false,
    }
}

/// Fill the latest-version + update-available fields (best-effort, bounded by
/// `timeout`). Only the managed copy can be updated, so this is a no-op — and
/// makes no network call — unless a managed binary is installed.
pub async fn fill_latest(status: &mut ToolStatus, tool: Tool, timeout: Duration) {
    if !status.managed_installed {
        return;
    }
    let latest = tokio::time::timeout(timeout, latest_version(tool))
        .await
        .ok()
        .and_then(|r| r.ok());
    if let (Some(latest), Some(current)) = (&latest, &status.managed_version) {
        status.update_available = is_newer(current, latest);
    }
    status.latest_version = latest;
}
