//! Reading a session worktree's changes: the diff against its base commit, and
//! the commits made since.

use std::path::Path;

use serde::Serialize;
use specta::Type;

use super::cli::run;
use crate::error::Result;

/// One changed file's stats and unified-diff patch (vs the session's base).
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiffFile {
    pub path: String,
    pub added: u32,
    pub removed: u32,
    pub binary: bool,
    pub patch: String,
}

/// A commit made on the session's branch since it forked from base.
#[derive(Debug, Serialize, Type)]
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

    // Untracked files are invisible to `diff <base>`; list them explicitly so
    // brand-new files show up too (with a synthesized all-add patch).
    let untracked = run(worktree, &["ls-files", "--others", "--exclude-standard"])?;
    for path in untracked.lines().map(str::trim).filter(|p| !p.is_empty()) {
        match std::fs::read_to_string(worktree.join(path)) {
            Ok(contents) => {
                let added = contents.lines().count() as u32;
                let patch: String = contents.lines().map(|l| format!("+{l}\n")).collect();
                files.push(DiffFile {
                    path: path.to_string(),
                    added,
                    removed: 0,
                    binary: false,
                    patch,
                });
            }
            // Unreadable as text → treat as binary, like numstat's `-` entries.
            Err(_) => files.push(DiffFile {
                path: path.to_string(),
                added: 0,
                removed: 0,
                binary: true,
                patch: String::new(),
            }),
        }
    }
    Ok(files)
}

/// One file's full before/after contents, for a rich (side-by-side) diff.
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileVersions {
    /// Contents at the base commit; `None` when the file was added.
    pub old_text: Option<String>,
    /// Working-tree contents; `None` when the file was deleted.
    pub new_text: Option<String>,
}

/// Read a file's contents at `base` and in the working tree. Either side is
/// `None` when it doesn't exist there (added/deleted) or isn't valid text.
pub fn file_versions(worktree: &Path, base: &str, path: &str) -> FileVersions {
    let old_text = run(worktree, &["show", &format!("{base}:{path}")]).ok();
    let new_text = std::fs::read_to_string(worktree.join(path)).ok();
    FileVersions { old_text, new_text }
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
