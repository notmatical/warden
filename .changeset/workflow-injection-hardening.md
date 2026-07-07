---
"@warden/desktop": patch
---

Prompt-injection hardening for workflows: permission-mode overrides are only honored for Custom nodes (a stale override can no longer make a Review/Plan node writable), injected context carries an explicit data-not-instructions boundary, the injected diff uses a fence that embedded backticks cannot break out of, and the Custom mode menu shows the real default (acceptEdits).
