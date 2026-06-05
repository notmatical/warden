---
"warden": patch
---

Fixed new sessions being filed under the last-focused group instead of the group that owns the root they were created from — the session's group is now derived from its root's parent group. The composer's "add a root" picker likewise now lists the session's own group's roots instead of the focused group's. Also stopped the group row flashing an accent background on click, and tightened the inline rename field's corner radius to match the rest of the UI.
