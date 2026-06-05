---
"warden": minor
---

Added a context-window meter to the composer toolbar: a progress ring + percentage showing how full the active model's context window is, colored amber/red as it fills. Clicking opens a breakdown — used/window tokens, input/output/cache-read/cache-write counts, and session cost. Token usage is now captured from each turn (Claude's assistant `usage`, Codex's `turn/completed`) and stored on the result event. The meter appears once a session's first turn reports usage.
