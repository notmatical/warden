---
"warden": minor
---

Replace the "Land session" dialog with a one-click **Create PR** button. The old local-merge (squash/merge/rebase into base) and in-app PR-merge paths are gone — they predate the diff viewer and the PR poller, which already retires a session (worktree teardown, merged marker) when its PR merges on GitHub. The new button shows on eligible worktree sessions (branch with changes over base, remote, no PR yet) and does the whole flow automatically: drafts a title/body from the branch's commits, commits, pushes, and opens the PR. Linear issue completion now happens when the poller sees the PR merge, so it also works for PRs merged on GitHub.
