---
"warden": patch
---

Background one-shots (session naming, PR drafting) now run on the session's own provider with its cheapest model, instead of always calling Claude/Haiku. The model catalog, per-role defaults, fast-tier variants, and fast-workflow picks all live in one shared config (src/config/models.json) read by both the app and the backend. PR descriptions without a repo template now follow a structured What changed / Why / Notes for review layout.
