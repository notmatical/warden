---
"warden": patch
---

Fix the file tree (and `@`-mention file list) showing empty for isolated worktree sessions: the walker honored the `*` gitignore in `.warden/worktrees/`, the worktree's parent directory, hiding every file. Parent ignore files no longer apply when walking a session's working directory.
