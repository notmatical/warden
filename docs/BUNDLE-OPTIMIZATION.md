# Bundle optimization

This document covers how warden's frontend bundle is built, what we've learned
about keeping it lean, and how to diagnose regressions.

---

## Toolchain

warden uses **Vite** with the **rolldown** bundler and **oxc** minifier (the
Rust-native successor to Rollup + esbuild). In CI and production builds:

```
bun run build:web   →   tsc --noEmit   →   vite build
```

The minifier is configured via `vite.config.ts`:

```ts
build: {
  minify: "oxc",   // faster than esbuild, smaller output than terser
}
```

Switching back to `"esbuild"` is safe but produces slightly larger output.

---

## What ships in the bundle

### Heavy dependencies to watch

| Package | Why it's heavy | Mitigation |
| --- | --- | --- |
| `@xyflow/react` | React Flow canvas (workflow editor) | Lazy-loaded — only imported in `workflow-editor.tsx` |
| `xterm` + addons | Terminal emulator | Loaded on-demand when a terminal session opens |
| `shiki` | Syntax highlighting (language grammars) | Single instance, initialized once via `lib/shiki.ts` |
| `react-markdown` + `rehype-raw` + `remark-gfm` | Markdown rendering in transcript | Shared across all message renders; no tree-shake opportunity |

### What Tailwind CSS Vite plugin does

The Tailwind v4 Vite plugin scans all source files at build time and emits
**only the CSS classes that appear in the source**. This means:

- Adding unused `className` strings does not enlarge the stylesheet.
- Dynamic class construction with string interpolation can defeat the scanner —
  prefer `cn(condition && "class-name")` over template strings.
- The `cn` and `cva` utility functions are registered as Tailwind-aware
  functions in `.prettierrc` so the formatter keeps their arguments sorted.

---

## Analyzing the bundle

### Quick size check

```bash
bun run build:web
# look at dist/assets/ — each chunk has its gzip size printed at the end
```

### Rollup visualizer

Install the plugin (dev-only, do not commit to prod config):

```bash
bun add -d rollup-plugin-visualizer
```

```ts
// vite.config.ts (temporary)
import { visualizer } from "rollup-plugin-visualizer"

plugins: [
  // ...existing plugins
  visualizer({ open: true, gzipSize: true, brotliSize: true }),
]
```

Run `bun run build:web` and the treemap opens automatically. Remove the plugin
before committing.

### What to look for

- **Duplicated packages** — two versions of the same library bundled separately.
  Usually caused by mismatched peer dependencies. Check with:
  ```bash
  bun why <package>
  ```
- **Unexpected large chunks** — a lazy-loaded route pulling in something it
  shouldn't. The visualizer makes these obvious.
- **Un-tree-shaken icon sets** — importing from `lucide-react` is fine; do not
  import the whole `lucide` barrel.

---

## Code splitting strategy

### Automatic splitting (Vite default)

Vite splits on dynamic `import()` boundaries. The workflow editor and terminal
are the primary split points:

```ts
// Already in place — these become separate chunks
const WorkflowEditor = React.lazy(() => import("./workflow/workflow-editor"))
const TerminalView = React.lazy(() => import("./terminal-view"))
```

The main bundle stays small; these modules load on first use.

### Vendor chunk grouping

Large stable dependencies that never change between app versions should be
grouped into long-lived cached vendor chunks. Add to `vite.config.ts` if chunk
fragmentation becomes a problem:

```ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        "vendor-react": ["react", "react-dom"],
        "vendor-flow": ["@xyflow/react"],
        "vendor-xterm": ["xterm", "xterm-addon-web-links", "xterm-addon-fit"],
      },
    },
  },
}
```

Only add groupings when there is measured benefit — premature chunking can
hurt cache hit rates.

---

## Build targets

`vite.config.ts` sets platform-specific targets:

```ts
build: {
  target: process.platform === "win32" ? "chrome105" : "safari13",
}
```

- **Windows** (Chrome 105) — enables native ESM, top-level await, and modern
  CSS without transforms. Keeps the bundle smaller.
- **macOS** (Safari 13) — more conservative; required because macOS WebKit is
  the WKWebView version shipped with the OS, not a bundled Chromium.

Do not lower targets without measuring the transform cost — polyfills for
older runtimes add bytes.

---

## Source maps

Source maps are only emitted in debug builds:

```ts
build: {
  sourcemap: process.env.TAURI_ENV_DEBUG === "true",
}
```

Never ship source maps in a release build — they add megabytes and expose
internal module paths.

---

## CI size budget (recommended)

We do not currently enforce a size budget in CI. When total bundle size becomes
a concern, add a check after `bun run build:web`:

```bash
# Fail if the main chunk exceeds 500 KB gzip
MAX=512000
SIZE=$(gzip -c dist/assets/index-*.js | wc -c)
[ "$SIZE" -le "$MAX" ] || (echo "Bundle too large: $SIZE bytes gzip"; exit 1)
```

---

## Checklist before shipping a heavy dependency

1. Is there a lighter alternative?
2. Is it used in a path that can be lazy-loaded?
3. Does it tree-shake? Check with the visualizer.
4. Does it duplicate a peer already in the bundle?
5. Is the gzip delta acceptable relative to the value it provides?
