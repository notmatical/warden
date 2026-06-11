---
"warden": patch
---

Restructure `.warden/config.json`: worktree setup/teardown commands now live under a `worktrees` section, matching `linear`. Saving worktree commands no longer deletes the Linear binding (all writers now merge-write their own section and preserve unknown keys), and legacy flat configs are still read and migrated on the next save.
