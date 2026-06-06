---
"warden": minor
---

Context injection (phase 1): attach files, folders, or saved text to a session and warden assembles them into the agent's system prompt — Claude via `--append-system-prompt-file` (+ `--add-dir` for files/folders), Codex via `thread/start` `baseInstructions`. A new paperclip "Context" control in the composer toolbar lists the attached sources with per-source enable/disable and remove. Context is re-assembled each turn, so adding or toggling a source takes effect on the next message (the warm Claude process is dropped so it respawns with the new context). GitHub PR/issue loaders come next.
