---
"warden": patch
---

Workflow editor hardening and panel polish: run status is scoped to the viewed workflow, duplicated/imported workflows get fresh node ids, pending edits flush when the tab closes, connections that would form a cycle are refused, a second concurrent run is blocked, canceled and restart-interrupted runs settle instead of showing as running forever, and the node side panel gains an identity header, status pills, error output, gate approval controls, and a Stop button on the canvas.
