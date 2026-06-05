---
"warden": patch
---

Fix canceling a Claude turn mid-stream. Stopping a turn now tree-kills the agent process (on Windows the `claude.cmd` shim spawns `node`; killing only the shim left `node` streaming and holding the session lock — so output kept arriving after "stop" and the next turn failed with "Session ID … is already in use"). Respawning a session also now resumes it whenever it was already initialized, instead of re-running `--session-id` on a session a cancelled first turn already created.
