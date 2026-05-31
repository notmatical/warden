//! Small shared helpers used across modules.

/// A fresh v4 UUID as a lowercase hyphenated string.
pub fn uuid() -> String {
    uuid::Uuid::new_v4().to_string()
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
