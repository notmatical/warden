---
"warden": patch
---

Fix the production build (`tsc -b` / `tauri build`), which failed to type-check. Resolves `Uint8Array`/`ArrayBuffer` mismatches in the workflow share codec under the newer TypeScript lib, a possibly-undefined model id in the model menu, a stale unused local in the transcript, and hast node typing in the markdown renderer. Generated tauri-specta bindings are now emitted with `@ts-nocheck` so their generator-shaped output no longer breaks the build.
