---
"warden": patch
---

Treat agents as collaborators that can pause mid-run to ask for input. Sessions now carry an "awaiting input" state, surfaced as a "Needs you" indicator across the tab strip, sessions table, command palette, and hover cards, plus an opt-out desktop notification when an agent pauses while you're away. Codex sessions can now pause mid-run for command/permission approvals (shown in the existing approval bar) and clarifying questions (shown in the AskUserQuestion widget), continuing the same turn once you answer — matching how OpenCode and Claude already behave.
