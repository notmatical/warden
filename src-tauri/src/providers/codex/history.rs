//! Discovers Codex's own rollout session files so a native Codex terminal can
//! resume the exact conversation it created. Codex assigns its session id (there
//! is no `--session-id` flag to pin one), so we recover it by scanning
//! `$CODEX_HOME/sessions` for the newest rollout whose recorded `cwd` matches the
//! session's working directory.

use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::util::{codex_home, same_path};

/// Newest Codex rollout id whose session was started in `working_dir`, skipping
/// ids already claimed by another warden session and one-shot `codex exec` runs.
/// Returns `None` when Codex has no matching saved session yet.
pub fn newest_session_for_cwd(working_dir: &str, exclude: &HashSet<String>) -> Option<String> {
    let mut files = Vec::new();
    collect_jsonl(&codex_home().join("sessions"), &mut files);
    // Newest first: rollout filenames lead with a timestamp, but modified time is
    // the authoritative ordering and survives clock-format quirks.
    files.sort_by_key(|p| fs::metadata(p).and_then(|m| m.modified()).ok());
    files.reverse();

    files.into_iter().find_map(|path| {
        let (id, cwd, is_exec) = read_session_meta(&path)?;
        (!is_exec && !exclude.contains(&id) && same_path(&cwd, working_dir)).then_some(id)
    })
}

fn collect_jsonl(root: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl(&path, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            out.push(path);
        }
    }
}

/// Read a rollout's `session_meta` header (always the first line) into its id,
/// originating cwd, and whether it came from a one-shot `codex exec` run.
fn read_session_meta(path: &Path) -> Option<(String, String, bool)> {
    let file = fs::File::open(path).ok()?;
    let mut first = String::new();
    BufReader::new(file).read_line(&mut first).ok()?;

    let value: Value = serde_json::from_str(first.trim()).ok()?;
    if value.get("type").and_then(Value::as_str) != Some("session_meta") {
        return None;
    }
    let payload = value.get("payload")?;
    let id = payload.get("id").and_then(Value::as_str)?.to_string();
    let cwd = payload.get("cwd").and_then(Value::as_str)?.to_string();
    let is_exec = payload.get("source").and_then(Value::as_str) == Some("exec")
        || payload.get("originator").and_then(Value::as_str) == Some("codex_exec");
    Some((id, cwd, is_exec))
}
