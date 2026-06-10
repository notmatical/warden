---
"warden": minor
---

Isolated worktrees now live inside the project at `.warden/worktrees/` (next to `.warden/config.json`) instead of under `~/warden`. Worktrees travel and die with the repo, two projects with the same name can no longer collide, and a self-ignoring `.gitignore` keeps the nested checkouts out of `git status`.
