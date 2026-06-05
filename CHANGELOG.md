# warden

## 0.2.0

### Minor Changes

- f87a078: Browser-global viewport: a single open-tab strip spanning every workspace, and a recursive split-tree pane layout — drag a tab or sidebar session onto a pane edge to split it (center to swap), and drag to reorder the strip.

  Also: colored Claude/Codex marks for native terminal tabs, an app-version footer and CLI-update banner in the sidebar, a fixed-height model menu that keeps locked providers visible (disabled) instead of hiding them, and a top-level error boundary with a recoverable fallback.

  Fixes: changing a session's model now re-homes it to that model's backend (so GPT models run on Codex), and the composer textarea re-measures its height when a pane is resized.
