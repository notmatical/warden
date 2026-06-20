//! Provider config/state directory resolution. Each provider stores credentials
//! and history under a home-relative directory, overridable by an env var.

use std::path::PathBuf;

use crate::util::home_dir;

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
