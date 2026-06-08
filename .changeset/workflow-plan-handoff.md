---
"warden": patch
---

Fix plan→code handoff in workflows. A Plan node delivers its plan via Claude's `ExitPlanMode` call, whose content the output harvest previously ignored — so the next node started with empty context. The harvest now includes the `ExitPlanMode` plan text. Workflow plans are also auto-accepted: their session no longer shows approve/revise controls (which would have wrongly resumed the node), just an "auto-accepted, handed to the next node" note. Use an explicit Approval gate node when you want to review a plan before it proceeds.
