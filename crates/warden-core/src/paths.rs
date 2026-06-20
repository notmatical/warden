//! Provider config/state directory resolution, plus warden's own per-session
//! working directories under the app data dir.
//!
//! Each provider stores credentials and history under a home-relative directory,
//! overridable by an env var. Warden's own scratch dirs (process spill files,
//! staged attachments, per-turn context files) hang off the app data dir, which
//! the shell records once at startup via [`set_app_data`].

use std::path::PathBuf;
use std::sync::OnceLock;

use crate::error::{AppError, Result};
use crate::util::home_dir;

/// Warden's app data directory, recorded once at startup. Distinct from the
/// managed-CLI app-data global in [`crate::cli`]: the shell seeds both with the
/// same path, but each layer owns its own slot so neither reaches into the other.
static APP_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Record warden's app data directory (call once at startup, before any agent
/// turn or recovery runs). Idempotent — later calls are ignored.
pub fn set_app_data(dir: PathBuf) {
    let _ = APP_DATA_DIR.set(dir);
}

fn app_data_dir() -> Result<&'static PathBuf> {
    APP_DATA_DIR
        .get()
        .ok_or_else(|| AppError::Agent("app data dir is not initialized".to_string()))
}

/// Create (if needed) and return `<app_data>/<sub>/<id>` — the shared body of the
/// per-session/per-id scratch dirs below.
fn ensure_scoped_dir(sub: &str, id: &str) -> Result<PathBuf> {
    let dir = app_data_dir()?.join(sub).join(id);
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Agent(e.to_string()))?;
    Ok(dir)
}

/// The per-session directory for detached-process output spill files
/// (`out-*.jsonl` / `err-*.log`). Created on demand.
pub fn session_dir(session_id: &str) -> Result<PathBuf> {
    ensure_scoped_dir("sessions", session_id)
}

/// The per-session directory staged chat attachments are copied into. Always
/// granted to the agent as an extra readable root. Created on demand.
pub fn attachments_dir(session_id: &str) -> Result<PathBuf> {
    ensure_scoped_dir("attachments", session_id)
}

/// The directory holding per-session assembled-context files for Claude's
/// `--append-system-prompt-file`. Created on demand.
pub fn context_dir() -> Result<PathBuf> {
    let dir = app_data_dir()?.join("context");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Agent(e.to_string()))?;
    Ok(dir)
}

/// `$env` if set, else `~/<default_suffix>`.
fn home_relative(env: &str, default_suffix: &str) -> PathBuf {
    std::env::var_os(env)
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().unwrap_or_default().join(default_suffix))
}

/// Codex's config/state directory. Honours `$CODEX_HOME`, defaulting to `~/.codex`.
pub fn codex_home() -> PathBuf {
    home_relative("CODEX_HOME", ".codex")
}

/// Claude Code's config/state directory. Honours `$CLAUDE_CONFIG_DIR`, defaulting
/// to `~/.claude`.
pub fn claude_home() -> PathBuf {
    home_relative("CLAUDE_CONFIG_DIR", ".claude")
}

/// OpenCode's data directory. OpenCode uses XDG paths on every platform
/// (including Windows): `$XDG_DATA_HOME/opencode`, defaulting to
/// `~/.local/share/opencode`. Stored credentials live in `auth.json` here.
pub fn opencode_data_dir() -> PathBuf {
    std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().unwrap_or_default().join(".local").join("share"))
        .join("opencode")
}
