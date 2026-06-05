---
"warden": minor
---

Plan mode is now first-class. When an agent finishes planning (`ExitPlanMode`), the transcript shows the plan as a reviewable card with **Approve & build** / **Keep planning** instead of a confusing denied-tool error. Approving flips the session out of `plan` into `acceptEdits` and resumes the agent to implement it; "Keep planning" lets you refine with a follow-up while staying in plan mode. The stray approval-bar prompt and "turn failed" error that used to accompany a plan pause are suppressed.
