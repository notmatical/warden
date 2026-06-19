---
"warden": patch
---

PR background polling no longer bumps a session's last-active time, so the sessions table's Last active column reflects real activity instead of the poll cadence.
