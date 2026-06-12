//! Discovers OpenCode's stored sessions so a native OpenCode terminal can
//! resume the exact conversation it created. OpenCode assigns its session id,
//! so we recover it by scanning `<data>/storage/session/<project>/*.json` for
//! the newest top-level session whose recorded directory matches the terminal's
//! working directory.

use std::collections::HashSet;
use std::fs;

use serde_json::Value;

use crate::util::{opencode_data_dir, same_path};

/// Newest OpenCode session id started in `working_dir`, skipping ids already
/// claimed by another warden session and subagent sessions (which carry a
/// `parentID`). Returns `None` when OpenCode has no matching saved session yet.
pub fn newest_session_for_cwd(working_dir: &str, exclude: &HashSet<String>) -> Option<String> {
    let root = opencode_data_dir().join("storage").join("session");
    let mut best: Option<(u64, String)> = None;

    for project in fs::read_dir(root).ok()?.flatten() {
        let Ok(files) = fs::read_dir(project.path()) else {
            continue;
        };
        for file in files.flatten() {
            let path = file.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Some(session) = read_session(&path) else {
                continue;
            };
            if exclude.contains(&session.1) || !same_path(&session.2, working_dir) {
                continue;
            }
            if best.as_ref().map_or(true, |(t, _)| session.0 > *t) {
                best = Some((session.0, session.1));
            }
        }
    }
    best.map(|(_, id)| id)
}

/// Read a stored session into (updated-at, id, directory). Subagent sessions
/// (`parentID` set) return `None` — only top-level conversations are resumable.
fn read_session(path: &std::path::Path) -> Option<(u64, String, String)> {
    let value: Value = serde_json::from_str(&fs::read_to_string(path).ok()?).ok()?;
    if value.get("parentID").is_some() {
        return None;
    }
    let id = value.get("id").and_then(Value::as_str)?.to_string();
    let directory = value.get("directory").and_then(Value::as_str)?.to_string();
    let updated = value
        .get("time")
        .and_then(|t| t.get("updated"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    Some((updated, id, directory))
}
