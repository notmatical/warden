---
"@warden/desktop": patch
---

Workflow runs can be retried: a failed run (including one interrupted by an app restart) gets a Retry button that re-runs only the unfinished nodes in the same worktree, keeping completed work. Review/Revise nodes are told explicitly when the worktree has no changes yet, and running a workflow from outside its project's group no longer files its sessions into the wrong group.
