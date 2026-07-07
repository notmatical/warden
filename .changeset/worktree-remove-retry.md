---
"@warden/desktop": patch
---

Worktree cleanup on Windows now retries when a file is briefly locked (antivirus, the search indexer), so a deleted session's worktree is removed instead of leaking.
