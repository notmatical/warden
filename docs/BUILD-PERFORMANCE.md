# Build performance

warden is a Tauri app — a Rust binary that hosts a React frontend. Build times
come from two places: the Rust compile and the Vite bundle. This document
covers how to keep both fast in development and CI.

---

## Local development

### First run

The first `bun run dev` compiles the full Rust crate, which includes Tauri
itself, tokio, rusqlite, and all provider code. Expect **3–8 minutes** on a
cold machine. This is a one-time cost.

### Incremental Rust compilation

Rust's incremental compiler reuses previously compiled artifacts stored in
`src-tauri/target/`. Subsequent builds after small changes compile only the
affected crates — typically **10–30 seconds**.

Rules for fast incremental builds:

1. **Don't `cargo clean` unless something is broken.** Cleaning discards all
   cached artifacts and forces a full rebuild.
2. **Avoid touching `Cargo.toml` unless necessary.** Dependency changes
   invalidate large parts of the incremental cache.
3. **Split large Rust modules into sub-modules.** Rust recompiles at the crate
   granularity; very large files compile slower even when unchanged elsewhere.

### Switching between `dev` and `build`

`bun run dev` and `bun run build` compile different Rust profiles (`dev` vs
`release`). Artifacts from one profile don't speed up the other — they're in
separate subdirectories of `target/`. Keep to one mode per session.

### Frontend-only iteration

When working purely on the React side with no backend changes, use:

```bash
bun run dev:web   # Vite only, port 1420, ~300 ms cold start
```

Tauri `invoke()` calls will fail (no backend), but all pure UI work is fast
with full HMR.

### Vite HMR

React Fast Refresh is configured via `@vitejs/plugin-react`. Component edits
hot-swap in-browser without losing state. When HMR stops working (usually after
editing a module that isn't a component), the page reloads automatically.

---

## Rust compilation tips

### `mold` or `lld` linker (Linux)

The default system linker is slow for large Rust projects. On Linux CI, swap
to `mold`:

```toml
# src-tauri/.cargo/config.toml
[target.x86_64-unknown-linux-gnu]
linker = "clang"
rustflags = ["-C", "link-arg=-fuse-ld=mold"]
```

This is already implied by the Tauri CI action on GitHub.

### `sccache` for shared CI cache (optional)

If CI minutes become expensive, `sccache` can cache compiled Rust artifacts
across runs:

```yaml
- uses: mozilla-actions/sccache-action@v0.0.4
- name: Build
  env:
    RUSTC_WRAPPER: sccache
  run: bun run tauri build --no-bundle
```

The cache is keyed on rustc version + Cargo.lock. Useful when the Rust code
changes infrequently.

---

## CI pipeline

### Current layout (`.github/workflows/ci.yml`)

```
frontend (ubuntu-latest)   → typecheck
rust (ubuntu-22.04)        → rustfmt + clippy
build (windows-latest)     → tauri build --no-bundle   [needs: frontend, rust]
```

The `frontend` and `rust` jobs run in parallel. `build` only starts after both
pass, so a type error or clippy warning cancels the expensive Windows build.

### Concurrency cancellation

In-progress runs on the same branch are cancelled when a new push arrives:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

This prevents queued builds from stacking up on fast-moving branches.

### Caching dependencies

**Bun** and **Rust** dependencies are the two largest caches. The standard
patterns:

```yaml
# Bun
- uses: oven-sh/setup-bun@v1
  with:
    bun-version: "1.3.8"

- uses: actions/cache@v4
  with:
    path: ~/.bun/install/cache
    key: ${{ runner.os }}-bun-${{ hashFiles('bun.lockb') }}

# Rust
- uses: actions/cache@v4
  with:
    path: |
      ~/.cargo/registry/index
      ~/.cargo/registry/cache
      ~/.cargo/git/db
      src-tauri/target
    key: ${{ runner.os }}-cargo-${{ hashFiles('src-tauri/Cargo.lock') }}
    restore-keys: ${{ runner.os }}-cargo-
```

The Rust cache is the more important one — restoring `target/` from a warm
run saves several minutes on the Windows build job.

### Why Windows for the build job

warden ships as a Windows MSI/NSIS installer. The `build` job uses
`windows-latest` so the Tauri bundler produces an actual linkable binary
against the right Windows SDK. Running the build on Linux would catch compile
errors but not Windows-specific linking issues (`silent_command`,
`kill_process_tree`, etc.).

---

## Optimizing CI minutes

### Measure first

GitHub Actions shows per-job runtimes in the Summary view. Before optimizing,
note the baseline:

- `frontend`: ~1 min (type-check only)
- `rust`: ~4–6 min (clippy on cold cache)
- `build`: ~8–12 min (Tauri Windows build)

### Targeted improvements

| Bottleneck | Fix |
| --- | --- |
| Slow Rust job (clippy) | Add cargo cache (see above) |
| Slow Windows build | Add cargo cache; consider `--no-bundle` (already done) |
| Flaky bun installs | `--frozen-lockfile` already enforced; keep `bun.lockb` committed |
| Redundant re-runs | Concurrency cancel already configured |

### Skipping the build job on docs-only changes

Add a path filter so the expensive `build` job doesn't run for markdown or
docs changes:

```yaml
jobs:
  build:
    if: |
      github.event_name != 'pull_request' ||
      contains(github.event.pull_request.changed_files, 'src') ||
      contains(github.event.pull_request.changed_files, 'src-tauri')
```

Or use `dorny/paths-filter` for finer control.

---

## Release builds

Release builds (`bun run build`) compile Rust with `--release`, which enables
full optimization (LTO, dead-code elimination). These are significantly slower
than debug builds — expect **15–25 minutes** on a developer machine, **8–15
minutes** in CI with a warm cache.

Release builds should only run in the `release.yml` workflow, not on every PR.
The `ci.yml` `build` job intentionally uses `--no-bundle` to verify linkage
without paying the bundler cost.

---

## Profiling a slow build

### Rust: `cargo build --timings`

```bash
cd src-tauri
cargo build --timings
# opens target/cargo-timings/cargo-timing.html
```

The waterfall shows which crates are on the critical path and which could be
parallelized. Crates that stall the graph are candidates for feature-flagging
or extraction.

### Vite: `--debug hmr`

```bash
VITE_DEBUG=hmr bun run dev:web
```

Logs HMR dependency graph resolution. Useful when a seemingly small edit
causes a full-page reload instead of a component swap.
