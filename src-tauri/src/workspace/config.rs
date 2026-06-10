//! `.warden/config.json`: per-repo configuration committed alongside the code,
//! so worktree setup/teardown commands are shared with the whole team.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{AppError, Result};

/// Per-repo config. All fields default so a partial file stays valid.
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct RepoConfig {
    /// Commands run in a fresh worktree right after it is created (e.g.
    /// `pnpm install`, copying `.env`). Joined with `&&`, so the first
    /// failure stops the chain.
    pub setup: Vec<String>,
    /// Commands run in a worktree just before it is removed.
    pub teardown: Vec<String>,
}

fn config_path(repo: &Path) -> PathBuf {
    repo.join(".warden").join("config.json")
}

/// Load a repo's config. A missing file reads as an empty config; a malformed
/// one is an error so the settings UI can't silently clobber it.
pub fn load(repo: &Path) -> Result<RepoConfig> {
    let path = config_path(repo);
    if !path.exists() {
        return Ok(RepoConfig::default());
    }
    let raw = fs::read_to_string(&path)?;
    serde_json::from_str(&raw)
        .map_err(|e| AppError::Invalid(format!(".warden/config.json is invalid: {e}")))
}

/// Load for execution paths: a malformed file logs a warning and reads empty,
/// so provisioning never fails on bad config.
pub fn load_lenient(repo: &Path) -> RepoConfig {
    load(repo).unwrap_or_else(|e| {
        log::warn!("ignoring repo config at {:?}: {e}", config_path(repo));
        RepoConfig::default()
    })
}

pub fn save(repo: &Path, config: &RepoConfig) -> Result<()> {
    let path = config_path(repo);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut json = serde_json::to_string_pretty(config)?;
    json.push('\n');
    fs::write(&path, json)?;
    Ok(())
}

/// Drop empty/whitespace-only command lines.
pub(super) fn clean(commands: Vec<String>) -> Vec<String> {
    commands
        .into_iter()
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty())
        .collect()
}
