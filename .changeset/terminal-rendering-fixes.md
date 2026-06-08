---
"warden": minor
---

Native terminals now render on the GPU (xterm WebGL renderer) for crisper,
faster output, falling back to xterm's built-in DOM renderer when WebGL is
unavailable or its context is lost.

Also fix two rendering glitches. xterm is now opened only once its
element is live in the DOM and re-fitted after fonts settle, so the grid no
longer measures too early and sits narrower than its pane. Re-parenting (tab
switches) and the window regaining visibility/focus now force a repaint, clearing
the ghost/floating duplicate text that previously lingered until a manual resize.
Resize also skips degenerate 0×0 dimensions that could crash the PTY.
