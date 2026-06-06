---
"warden": minor
---

Reworked the app header into a clean action cluster:

- **CLI updates** — a download icon (with a count badge) that appears only when an agent CLI needs installing or updating. Its popover lists each provider with `cur → latest` and an Install/Update action that shows live progress. Stays hidden when everything's current.
- **GitHub** — a one-click button that opens the active repo's `origin` remote in the browser (new `repo_browse_url` command normalizes SSH/HTTPS remotes); hidden when there's no recognizable remote.
- **Open in…** — slimmed from the Zed-centric split button to an icon that opens your last-used target (Zed / VS Code / Terminal / File explorer) in one click, with a dropdown for the rest, remembering your choice.
