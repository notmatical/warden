//! Gitignore-aware file listing for `@`-mention completion. Synchronous; the
//! shell runs it on a blocking thread.

use std::path::Path;

use ignore::WalkBuilder;
use serde::Serialize;
use specta::Type;

/// Default cap on the number of files returned, to bound the completion payload.
pub const MAX_FILES: usize = 5000;

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    /// Path relative to the working directory, using forward slashes.
    pub path: String,
    pub name: String,
}

/// List files under `working_dir`, honoring .gitignore, capped at `max`.
pub fn walk_files(working_dir: &str, max: usize) -> Vec<FileEntry> {
    let root = Path::new(working_dir);
    let mut out = Vec::new();

    // `parents(false)`: ignore files above the session root must not apply —
    // worktrees live under `<repo>/.warden/worktrees/`, whose `*` gitignore
    // would otherwise hide every file in them.
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .require_git(false)
        .parents(false)
        .build();

    for entry in walker.flatten() {
        if out.len() >= max {
            break;
        }
        let path = entry.path();
        if path == root || path.components().any(|c| c.as_os_str() == ".git") {
            continue;
        }
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let rel = path.strip_prefix(root).unwrap_or(path);
        out.push(FileEntry {
            path: rel.to_string_lossy().replace('\\', "/"),
            name: path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
        });
    }

    out
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::walk_files;

    /// Worktrees live under `<repo>/.warden/worktrees/`, whose `*` gitignore
    /// must not hide the worktree's own files from the walker.
    #[test]
    fn walk_ignores_parent_gitignore() {
        let tmp = tempfile::tempdir().unwrap();
        let worktrees = tmp.path().join(".warden").join("worktrees");
        let wt = worktrees.join("abc123");
        fs::create_dir_all(wt.join("src")).unwrap();
        fs::write(worktrees.join(".gitignore"), "*\n").unwrap();
        fs::write(wt.join("src").join("main.rs"), "fn main() {}\n").unwrap();
        fs::write(wt.join(".gitignore"), "target/\n").unwrap();
        fs::create_dir_all(wt.join("target")).unwrap();
        fs::write(wt.join("target").join("out.bin"), "").unwrap();

        let files = walk_files(&wt.to_string_lossy(), 100);
        let paths: Vec<_> = files.iter().map(|f| f.path.as_str()).collect();

        assert!(
            paths.contains(&"src/main.rs"),
            "files hidden by parent gitignore: {paths:?}"
        );
        // The worktree's own gitignore still applies.
        assert!(
            !paths.iter().any(|p| p.starts_with("target/")),
            "own gitignore not applied: {paths:?}"
        );
    }
}
