---
"warden": minor
---

The git status chips now expose push/pull: on the session's primary repo the **↑ahead** and **↓behind** counters are clickable — ↑ pushes your branch to its origin, ↓ pulls the latest upstream commits (fetch + merge, conflict-aware with the clashing files surfaced). Each shows a spinner while running and refreshes status on success. (The existing Sync button — rebase onto the base branch — is unchanged and distinct.)
