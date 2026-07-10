# @warden/ui

## 0.1.12

### Patch Changes

- 7d8f47f: Adopt a browser-style inset shell: session tabs move into the 40px titlebar and the active tab merges into the floating content card (concave corner fillers, hairline dividers, hover pills). Tabs reorder live while dragging — neighbors slide aside and a lifted clone follows the cursor, gliding into its slot on drop — and Ctrl+Tab / Ctrl+Shift+Tab cycle through open tabs. The sidebar migrates to the @warden/ui inset-variant sidebar, and the window frame token steps below the content color in both themes so the card floats. The @warden/ui sidebar gains a `--sidebar-top` header offset, a `keyboardShortcut` opt-out, and a Cookie Store API guard for WebKit webviews.
