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

/// Decode the valid UTF-8 prefix of `pending`, leaving any incomplete trailing
/// bytes for the next read. Invalid sequences become a replacement char. Used by
/// the PTY reader to turn a byte stream into incremental, boundary-safe text.
pub fn drain_utf8(pending: &mut Vec<u8>) -> String {
    match std::str::from_utf8(pending) {
        Ok(s) => {
            let out = s.to_string();
            pending.clear();
            out
        }
        Err(e) => {
            let valid = e.valid_up_to();
            let mut out = String::new();
            if valid > 0 {
                // Safe: `valid` is a UTF-8 boundary per `valid_up_to`.
                out.push_str(unsafe { std::str::from_utf8_unchecked(&pending[..valid]) });
            }
            match e.error_len() {
                Some(bad) => {
                    out.push('\u{FFFD}');
                    pending.drain(..valid + bad);
                    out.push_str(&drain_utf8(pending));
                }
                None => {
                    pending.drain(..valid);
                }
            }
            out
        }
    }
}
