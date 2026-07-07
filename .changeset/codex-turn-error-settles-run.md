---
"@warden/desktop": patch
---

Fix Codex turn-level errors hanging a session (and any workflow run driving it). An invalid-model 400 like "model is not supported when using Codex with a ChatGPT account" arrives as a non-retrying error with no thread id; previously it was dropped and the turn ran forever. Now a bare top-level error is routed to the sole in-flight turn, a non-retrying error (absent `willRetry` included) ends the turn and settles the session to Error, and a failed `Result` settles to Error instead of Idle for every run-to-completion provider. A workflow node whose agent fails now fails the run.
