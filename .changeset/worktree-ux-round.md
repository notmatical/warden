---
"warden": minor
---

Worktree UX round: the composer's bare branch icon is now an identity chip showing the worktree branch (or "checkout") with a menu for the full story — branch, base, on-disk path with copy/reveal, setup progress, and the isolation opt-out. Worktree setup failures get a dedicated full-pane error view (raw output, retry, open folder, continue anyway) instead of a transcript callout. The worktree commands editor is reworked a reference app-style: Setup/Teardown tabs, auto-save with a quiet Saved indicator, and one-click insertion of the `WARDEN_*` variables in platform shell syntax. The Changes tab is no longer worktree-only — any session with a recorded fork point can open it by clicking the +N/−N counter on its status chip — and it gains a Browse tab: a gitignore-aware file tree with a read-only syntax-highlighted viewer.
