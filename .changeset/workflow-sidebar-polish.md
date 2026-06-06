---
"warden": minor
---

Sidebar Workflows section gets a real visual hierarchy: collapse-and-hide the whole section from its header, a 5-row cap with **Show all / Show fewer** (active runs are always visible regardless of the cap), per-row status tinting (subtle row glow + trailing dot for running/paused/failed), a folder-count badge on the group row, and a clustered run-count + active dot on the section header. The cap and tinting eliminate the "no runs yet" scan problem when you have many workflows. New helper: sessions slice keeps `sessionsByWorkflow` in sync as the executor emits session-updated, so newly-spawned node sessions appear under the workflow without a refresh.
