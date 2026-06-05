# warden

## 0.3.0

### Minor Changes

- 83ff7fd: Plan mode is now first-class. When an agent finishes planning (`ExitPlanMode`), the transcript shows the plan as a reviewable card with **Approve & build** / **Keep planning** instead of a confusing denied-tool error. Approving flips the session out of `plan` into `acceptEdits` and resumes the agent to implement it; "Keep planning" lets you refine with a follow-up while staying in plan mode. The stray approval-bar prompt and "turn failed" error that used to accompany a plan pause are suppressed.
- 9fc09bf: Added a sub-agent overview panel. A collapsible "Sub-agents N/M" bar sits above the composer whenever a session spawns Task/Agent subagents, showing each one's status (running/done/error) and prompt. Clicking a row opens a side sheet that replays that subagent's full activity — its prompt, tool calls (with the new diff/output panels), and final report — without leaving the session.
- 99c3c01: Redesigned tool-call activity in the transcript: each call is now a compact Claude-style summary line (`Read foo.ts`, `Edited foo.ts +5 −2`, `$ npm run build`, `Searched …`) that expands into a focused detail panel. Edits open a scrollable diff viewer with a file-path header and per-line add/remove coloring; writes/reads show the file body; Bash shows the command and its output; `TodoWrite` renders the checklist. Works across both Claude and Codex tool shapes, and subagent (Task) calls still nest their own rows.

## 0.2.0

### Minor Changes

- f87a078: Browser-global viewport: a single open-tab strip spanning every workspace, and a recursive split-tree pane layout — drag a tab or sidebar session onto a pane edge to split it (center to swap), and drag to reorder the strip.

  Also: colored Claude/Codex marks for native terminal tabs, an app-version footer and CLI-update banner in the sidebar, a fixed-height model menu that keeps locked providers visible (disabled) instead of hiding them, and a top-level error boundary with a recoverable fallback.

  Fixes: changing a session's model now re-homes it to that model's backend (so GPT models run on Codex), and the composer textarea re-measures its height when a pane is resized.
