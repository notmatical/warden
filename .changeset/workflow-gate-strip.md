---
"warden": patch
---

Strip the workflow Approval Gate to its essence. It's now called **User Approval**, has no config sheet, no prompt field, and a fixed label — a gate is a pure sign-off between agent steps. Backend `NodeKind::Gate` becomes a unit variant (no `GateConfig`), the frontend type drops `GateConfig`, and selecting a gate on the canvas no longer opens the right-side panel.
