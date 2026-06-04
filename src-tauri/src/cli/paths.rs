//! Filesystem locations for managed CLI binaries and the single [`resolve`] that
//! every spawn site uses to find the effective binary for a tool.

use std::path::PathBuf;
use std::sync::OnceLock;

use super::source::{self, Source};
use super::Tool;

static APP_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Record warden's app data directory (called once at startup).
pub fn set_app_data(dir: PathBuf) {
    let _ = APP_DATA_DIR.set(dir);
}

fn binary_file_name(tool: Tool) -> String {
    if cfg!(windows) {
        format!("{}.exe", tool.bin())
    } else {
        tool.bin().to_string()
    }
}

/// The directory warden installs a tool's managed binary into.
pub fn cli_dir(tool: Tool) -> Option<PathBuf> {
    APP_DATA_DIR.get().map(|dir| dir.join(tool.cli_dir_name()))
}

/// Absolute path to a tool's managed binary (whether or not it exists yet).
pub fn managed_binary_path(tool: Tool) -> Option<PathBuf> {
    cli_dir(tool).map(|dir| dir.join(binary_file_name(tool)))
}

/// The managed binary, only if it is actually installed on disk.
pub fn managed_installed(tool: Tool) -> Option<PathBuf> {
    managed_binary_path(tool).filter(|p| p.exists())
}

/// The tool's binary on the system PATH, if present.
pub fn system_binary(tool: Tool) -> Option<PathBuf> {
    which::which(tool.bin()).ok()
}

/// Create (if needed) and return a tool's managed CLI directory.
pub fn ensure_cli_dir(tool: Tool) -> Result<PathBuf, String> {
    let dir = cli_dir(tool).ok_or("app data dir is not initialized")?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("failed to create {dir:?}: {e}"))?;
    Ok(dir)
}

/// The binary a caller should actually spawn for `tool`, honouring the source
/// preference. Explicit pins (Managed/System) don't silently cross over, so a
/// missing pinned binary surfaces as a clear "not found" at spawn time.
pub fn resolve(tool: Tool) -> PathBuf {
    let bare = || PathBuf::from(tool.bin());
    match source::source(tool) {
        Source::Auto => system_binary(tool)
            .or_else(|| managed_installed(tool))
            .or_else(|| managed_binary_path(tool))
            .unwrap_or_else(bare),
        Source::System => system_binary(tool).unwrap_or_else(bare),
        Source::Managed => managed_binary_path(tool).unwrap_or_else(bare),
    }
}
