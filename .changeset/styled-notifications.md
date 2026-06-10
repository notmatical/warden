---
"warden": minor
---

Styled notifications with sounds: background notifications now render in a Warden-styled always-on-top popup (bottom-right, click to jump to the session/workflow or open the Linear issue, auto-dismiss with hover-pause) instead of stock OS toasts — which also fixes dev builds attributing notifications to "Windows PowerShell". Each event type gets a configurable sound (bundled audio plus synthesized options) and a master volume in Settings → Notifications, alongside a "Send test" button; error-toned notifications (agent stopped, checks failed) automatically use a distinct error sound. Native OS toasts remain as a fallback if the popup window is unavailable.
