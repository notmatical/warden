---
"warden": minor
---

Redesigned tool-call activity in the transcript: each call is now a compact Claude-style summary line (`Read foo.ts`, `Edited foo.ts +5 −2`, `$ npm run build`, `Searched …`). Edits, writes, and commands expand inline by default into a focused panel; lookups stay collapsed. The diff viewer is now syntax-highlighted (shiki) with a line-number gutter, +/− markers, and add/remove tinting on a dark code surface; new files render as a green all-addition diff. Bash shows the command and its output; `TodoWrite` renders the checklist. Works across both Claude and Codex tool shapes, and subagent (Task) calls still nest their own rows.
