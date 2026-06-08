---
"warden": minor
---

Import/export workflows as shareable codes. Export a workflow (from its editor menu or the Workflows table row menu) to copy a compact, gzip-compressed `warden-wf-…` code to your clipboard; paste it into the new Import dialog on the Workflows page to recreate the workflow — graph, nodes, and layout intact — under the active project. Codes carry only the portable definition (name + graph); a fresh id and timestamps are minted on import, and invalid codes are rejected with a clear message.
