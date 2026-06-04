//! Small shared helpers used across modules.

use std::path::PathBuf;
use std::process::Command;

/// A fresh v4 UUID as a lowercase hyphenated string.
pub fn uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// The current user's home directory, from the platform's env var. Avoids
/// pulling in an extra crate for what is a single lookup.
pub fn home_dir() -> Option<PathBuf> {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var).map(PathBuf::from)
}

/// Codex's config/state directory. Honours `$CODEX_HOME`, defaulting to `~/.codex`.
pub fn codex_home() -> PathBuf {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().unwrap_or_default().join(".codex"))
}

/// Configure a `Command` so it never flashes a console window on Windows when
/// spawned from the GUI. A no-op on other platforms.
pub fn silent_command(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// The current UTC time as an RFC 3339 / ISO 8601 string.
pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// The first `len` characters of a string, used to derive short, human-friendly
/// identifiers (e.g. worktree branch names) from UUIDs.
pub fn short_id(id: &str, len: usize) -> String {
    id.chars().take(len).collect()
}
