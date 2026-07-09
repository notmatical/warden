---
"@warden/desktop": patch
---

Add Cursor and Grok as agent backends. Cursor runs per-turn against the
`cursor-agent` CLI (stdout stream-json, `--resume` continuation); Grok runs over
a pooled per-session ACP connection (`grok agent stdio`, JSON-RPC over stdio,
answering the agent's file/terminal/permission requests inline). Both list their
models live from the CLI and route by `cursor/`/`grok/` model-id prefixes. Both
install from the provider settings panel: Grok as a warden-managed npm install
(into the managed CLI dir, versioned from the npm registry), Cursor by running
its official installer onto the system PATH (the source preference then switches
to System). Effort tiers: Grok exposes low/medium/high; Cursor has none.
