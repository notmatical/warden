//! Managed provider CLIs: warden can install each agent CLI into its own app
//! data directory and run that copy, or defer to whatever is on the system PATH.
//! A per-provider [`Source`] preference selects which, and one [`resolve`] is the
//! single point every spawn site goes through to find the effective binary.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::Provider;

/// Where a provider's CLI comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// Prefer the system PATH copy; fall back to the managed one. The default.
    Auto,
    /// Always warden's managed copy.
    Managed,
    /// Always the system PATH copy.
    System,
}

impl Source {
    pub fn as_str(self) -> &'static str {
        match self {
            Source::Auto => "auto",
            Source::Managed => "managed",
            Source::System => "system",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "auto" => Some(Source::Auto),
            "managed" => Some(Source::Managed),
            "system" => Some(Source::System),
            _ => None,
        }
    }

    /// The settings key persisting a provider's source preference.
    pub fn setting_key(provider: Provider) -> String {
        format!("{}_cli_source", provider.id())
    }
}

static APP_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();
static SOURCES: OnceLock<RwLock<HashMap<Provider, Source>>> = OnceLock::new();

fn sources() -> &'static RwLock<HashMap<Provider, Source>> {
    SOURCES.get_or_init(|| RwLock::new(HashMap::new()))
}

/// Seed the app data dir and persisted source preferences at startup.
pub fn init(app_data_dir: PathBuf, initial: HashMap<Provider, Source>) {
    let _ = APP_DATA_DIR.set(app_data_dir);
    *sources().write().unwrap_or_else(|p| p.into_inner()) = initial;
}

/// The current source preference for a provider (defaults to [`Source::Auto`]).
pub fn source(provider: Provider) -> Source {
    sources()
        .read()
        .unwrap_or_else(|p| p.into_inner())
        .get(&provider)
        .copied()
        .unwrap_or(Source::Auto)
}

/// Update a provider's source preference in the in-memory cache. Callers persist
/// the value to the store separately.
pub fn set_source(provider: Provider, source: Source) {
    sources()
        .write()
        .unwrap_or_else(|p| p.into_inner())
        .insert(provider, source);
}

fn binary_file_name(provider: Provider) -> String {
    if cfg!(windows) {
        format!("{}.exe", provider.bin())
    } else {
        provider.bin().to_string()
    }
}

/// The directory warden installs a provider's managed binary into.
pub fn cli_dir(provider: Provider) -> Option<PathBuf> {
    APP_DATA_DIR
        .get()
        .map(|dir| dir.join(provider.cli_dir_name()))
}

/// Absolute path to a provider's managed binary (whether or not it exists yet).
pub fn managed_binary_path(provider: Provider) -> Option<PathBuf> {
    cli_dir(provider).map(|dir| dir.join(binary_file_name(provider)))
}

/// The managed binary, only if it is actually installed on disk.
pub fn managed_installed(provider: Provider) -> Option<PathBuf> {
    managed_binary_path(provider).filter(|p| p.exists())
}

/// The provider's binary on the system PATH, if present.
pub fn system_binary(provider: Provider) -> Option<PathBuf> {
    which::which(provider.bin()).ok()
}

/// The binary a session should actually spawn for `provider`, honouring the
/// source preference. Explicit pins (Managed/System) don't silently cross over,
/// so a missing pinned binary surfaces as a clear "not found" at spawn time.
pub fn resolve(provider: Provider) -> PathBuf {
    let bare = || PathBuf::from(provider.bin());
    match source(provider) {
        Source::Auto => system_binary(provider)
            .or_else(|| managed_installed(provider))
            .or_else(|| managed_binary_path(provider))
            .unwrap_or_else(bare),
        Source::System => system_binary(provider).unwrap_or_else(bare),
        Source::Managed => managed_binary_path(provider).unwrap_or_else(bare),
    }
}

// ----- install plumbing -----------------------------------------------------

/// Create (if needed) and return a provider's managed CLI directory.
pub fn ensure_cli_dir(provider: Provider) -> Result<PathBuf, String> {
    let dir = cli_dir(provider).ok_or("app data dir is not initialized")?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("failed to create {dir:?}: {e}"))?;
    Ok(dir)
}

/// Progress payload emitted to the frontend during an install.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub provider: String,
    pub stage: String,
    pub message: String,
    pub percent: u8,
}

/// Emit an install-progress event to the frontend.
pub fn emit_progress(app: &AppHandle, provider: Provider, stage: &str, message: &str, percent: u8) {
    let _ = app.emit(
        "cli:install-progress",
        InstallProgress {
            provider: provider.id().to_string(),
            stage: stage.to_string(),
            message: message.to_string(),
            percent,
        },
    );
}

/// Write a downloaded binary to `path` via a temp file + atomic rename. On
/// Windows a running binary holds a lock, so the existing file is moved aside
/// first; elsewhere the rename swaps the directory entry to the new inode.
pub fn write_binary_file(path: &std::path::Path, content: &[u8]) -> Result<(), String> {
    let temp_path = path.with_extension("tmp");
    std::fs::write(&temp_path, content).map_err(|e| format!("failed to write temp file: {e}"))?;

    #[cfg(windows)]
    {
        let old_path = path.with_extension("old");
        if path.exists() {
            let _ = std::fs::remove_file(&old_path);
            if let Err(e) = std::fs::rename(path, &old_path) {
                let _ = std::fs::remove_file(&temp_path);
                return Err(format!("failed to replace existing binary: {e}"));
            }
        }
        if let Err(e) = std::fs::rename(&temp_path, path) {
            let _ = std::fs::rename(&old_path, path);
            return Err(format!("failed to install new binary: {e}"));
        }
        let _ = std::fs::remove_file(&old_path);
    }

    #[cfg(not(windows))]
    {
        if let Err(e) = std::fs::rename(&temp_path, path) {
            let _ = std::fs::remove_file(&temp_path);
            return Err(format!("failed to install new binary: {e}"));
        }
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(path, perms);
        }
    }

    Ok(())
}
