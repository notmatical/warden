---
"warden": patch
---

Fixed installing/updating the Codex CLI failing with "asset … not found". The `openai/codex` repo publishes several release streams (`rusty-v8-*`, `codex-app-server-*`, …); warden was picking the newest release with any asset, which often had no CLI binary. It now only considers releases that actually ship the host's `codex-<target>` asset, and prefers the newest stable over alpha prereleases.
