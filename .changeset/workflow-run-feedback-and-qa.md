---
"warden": patch
---

Workflow runs no longer look stuck while a fresh worktree installs dependencies: setup (e.g. `bun install`) runs off the critical path, node sessions appear immediately, and each node shows a "Setting up workspace" status until the tree is ready (a code node still waits so it never runs against missing deps). A crashed executor now settles the run as failed instead of leaving a phantom "Running". The Run button is disabled up front when a required prompt is empty, and run history moves from the status-pill dropdown into a collapsible table tucked above the zoom controls.
