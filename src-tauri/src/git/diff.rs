//! Reading a session worktree's changes: the diff against its base commit, and
//! the commits made since.

use std::path::Path;

use serde::Serialize;

use super::cli::run;
use crate::error::Result;

/// One changed file's stats and unified-diff patch (vs the session's base).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFile {
    pub path: String,
    pub added: u32,
    pub removed: u32,
    pub binary: bool,
    pub patch: String,
}

/// A commit made on the session's branch since it forked from base.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub sha: String,
    pub subject: String,
    pub author: String,
    pub date: String,
}

/// Every change in `worktree` since `base` — committed *and* uncommitted — one
/// entry per file with its patch. Untracked files are not included.
pub fn worktree_diff(worktree: &Path, base: &str) -> Result<Vec<DiffFile>> {
    let numstat = run(worktree, &["diff", base, "--numstat"])?;
    let mut files = Vec::new();
    for line in numstat.lines() {
        let mut cols = line.split('\t');
        let added = cols.next().unwrap_or("0");
        let removed = cols.next().unwrap_or("0");
        let Some(path) = cols.next().map(str::trim).filter(|p| !p.is_empty()) else {
            continue;
        };
        // Binary files report "-" for both counts and carry no textual patch.
        let binary = added == "-" || removed == "-";
        let patch = if binary {
            String::new()
        } else {
            run(worktree, &["diff", base, "--", path]).unwrap_or_default()
        };
        files.push(DiffFile {
            path: path.to_string(),
            added: added.parse().unwrap_or(0),
            removed: removed.parse().unwrap_or(0),
            binary,
            patch,
        });
    }
    Ok(files)
}

/// Commits on the worktree's branch since `base`, newest first (capped).
pub fn commits_since(worktree: &Path, base: &str, limit: u32) -> Result<Vec<Commit>> {
    let range = format!("{base}..HEAD");
    let max = format!("--max-count={limit}");
    // Unit-separator (\x1f) between fields; one commit per line (subject has none).
    let out = run(
        worktree,
        &[
            "log",
            &range,
            &max,
            "--date=short",
            "--format=%H%x1f%s%x1f%an%x1f%ad",
        ],
    )?;
    Ok(out
        .lines()
        .filter_map(|line| {
            let mut f = line.split('\u{1f}');
            Some(Commit {
                sha: f.next()?.to_string(),
                subject: f.next()?.to_string(),
                author: f.next().unwrap_or_default().to_string(),
                date: f.next().unwrap_or_default().to_string(),
            })
        })
        .collect())
}
