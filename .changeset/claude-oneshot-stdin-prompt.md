---
"warden": patch
---

Fix one-shot Claude calls (session auto-naming, recipes, PR title/body generation) failing on Windows npm installs with "batch file arguments are invalid". The prompt is now fed over stdin instead of as a command-line argument — a multiline prompt can't be passed to a `claude.cmd` shim — so these features work regardless of whether `claude` resolves to a native binary or a batch shim.
