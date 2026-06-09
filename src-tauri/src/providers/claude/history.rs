//! Detects whether Claude has a persisted conversation for a session id.
//!
//! Claude Code writes each conversation to
//! `<claude_home>/projects/<encoded-cwd>/<session-id>.jsonl`, but only lazily:
//! the file appears once the first message is exchanged. A native terminal that
//! was opened but never used therefore has no file, and resuming it with
//! `--resume` would fail ("No conversation found"). We look the id up across
//! every project dir so we never depend on Claude's cwd-encoding scheme.

use std::fs;

use crate::util::claude_home;

/// Whether Claude has persisted a conversation for `session_id` — i.e. any
/// project dir under `<claude_home>/projects` holds `<session_id>.jsonl`.
pub fn conversation_exists(session_id: &str) -> bool {
    let Ok(entries) = fs::read_dir(claude_home().join("projects")) else {
        return false;
    };
    let file = format!("{session_id}.jsonl");
    entries
        .flatten()
        .any(|entry| entry.path().join(&file).is_file())
}
