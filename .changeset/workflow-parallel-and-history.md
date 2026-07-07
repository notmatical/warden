---
"@warden/desktop": patch
---

Workflow splits now run in parallel: read-only nodes (plan, review) execute concurrently while nodes that write code take the shared worktree exclusively, so a code step fanning out to several reviewers runs them all at once. Gates wait for in-flight branches to drain before pausing, and a failed branch lets its siblings finish before the run settles. The editor's status pill also opens a run history: pick any past run to view its node states and outputs on the canvas, then jump back to the latest.
