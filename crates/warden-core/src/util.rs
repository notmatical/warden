//! Small generic helpers used across the crate.

use std::path::PathBuf;

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

/// The current UTC time as an RFC 3339 / ISO 8601 string.
pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Compare two paths for "same location", tolerant of separators and (on
/// Windows) case. Avoids `canonicalize` so it still matches dirs that no
/// longer exist.
pub fn same_path(a: &str, b: &str) -> bool {
    fn norm(p: &str) -> String {
        let trimmed = p.replace('\\', "/").trim_end_matches('/').to_string();
        if cfg!(windows) {
            trimmed.to_lowercase()
        } else {
            trimmed
        }
    }
    norm(a) == norm(b)
}

/// The first `len` characters of a string, used to derive short, human-friendly
/// identifiers (e.g. worktree branch names) from UUIDs.
pub fn short_id(id: &str, len: usize) -> String {
    id.chars().take(len).collect()
}
