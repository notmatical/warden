---
"warden": minor
---

Codex turns now carry a per-turn sandbox derived from the session's current permission mode, sent on `turn/start` (a thread's sandbox was previously fixed at thread start and always `workspace-write`). Plan mode is now genuinely read-only for Codex, `bypassPermissions` grants full access, and switching permission mode mid-session takes effect on the next turn. Edit modes mark the session's working directory and any extra roots writable so worktree commits and multi-root sessions aren't blocked by the sandbox.
