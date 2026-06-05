---
"warden": minor
---

Redesigned tool-call activity in the transcript: each call is now a compact Claude-style summary line (`Read foo.ts`, `Edited foo.ts +5 −2`, `$ npm run build`, `Searched …`) that expands into a focused detail panel. Edits open a scrollable diff viewer with a file-path header and per-line add/remove coloring; writes/reads show the file body; Bash shows the command and its output; `TodoWrite` renders the checklist. Works across both Claude and Codex tool shapes, and subagent (Task) calls still nest their own rows.
