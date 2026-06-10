---
"warden": minor
---

Worktree cleanup lifecycle: deleting a session now stops its agent **and** PTY, runs the repo's teardown commands, removes the worktree, and prunes its branch — but first the UI names what would be destroyed (uncommitted files, unmerged commits) and asks, instead of force-deleting work. Worktrees shared by sibling sessions (plan→code pairs, workflow nodes) are left in place until the last session goes, and warden only ever removes paths under its own managed worktrees root. When a session's PR merges on GitHub, the background poller now auto-retires the session: worktree and branch are torn down and the session becomes read-only, same as landing it in-app.
