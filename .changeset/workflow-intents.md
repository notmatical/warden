---
"warden": minor
---

Workflows are now built from intent-typed nodes instead of blank tasks. Each node has an intent — **Plan, Code, Review, Revise, Custom** — that carries a built-in behavior, the right mode, and what it reads, so downstream nodes need no hand-written task: the edge carries the work (the upstream plan/review and the worktree diff are injected as context). Add an **Approval gate** node to pause a run for your sign-off (Approve/Reject right on the node). A run now provisions one isolated per-run branch shared by all nodes (Review reads its diff). The editor gets a typed node palette, an intent-driven config panel, and per-node icons/colors. Your "Plan → approve → Code → Review → approve → Revise" workflow is a drop-in.
