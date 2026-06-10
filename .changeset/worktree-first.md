---
"warden": minor
---

Worktree-first sessions: agent sessions now isolate in a git worktree by default (the composer's GitBranch toggle becomes an opt-out; plain terminal sessions stay in the checkout). Repos can define worktree setup/teardown commands in a committed `.warden/config.json` — setup runs in every fresh worktree (chained with `&&`, with `WARDEN_WORKTREE_PATH`/`WARDEN_ROOT_PATH` env vars, progress narrated as session notices), teardown runs best-effort before a worktree is removed; both are editable from the folder view's wrench button.
