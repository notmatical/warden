---
"warden": minor
---

Settings is now a real tab instead of a modal dialog. Clicking the sidebar's Settings button opens a `settings` tab in the viewport — closeable, switchable, and drag-to-split alongside a session or a workflow. The "remembered section" persists across tab open/close, and `openSettings("integrations")` still works as a deep link. Replaces the old `SettingsDialog`; the tab strip + pane system gained a reusable `StaticTab` primitive shared with workflow tabs.
