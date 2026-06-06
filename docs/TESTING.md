# Testing

warden is currently light on automated tests — the app is integration-heavy and
most behavior is verified manually through `bun run dev`. This document records
the current state, the plan for filling the gaps, and instructions for running
what exists.

---

## Current state

| Layer | Status |
| --- | --- |
| Rust unit tests | None |
| Rust integration tests | None |
| Frontend unit tests (Vitest) | None |
| Frontend component tests | None |
| E2E tests (Playwright/WebdriverIO) | None |
| Linting (ESLint + Prettier) | ✓ CI-enforced |
| Type checking (tsc) | ✓ CI-enforced |
| Rust formatting (rustfmt) | ✓ CI-enforced |
| Rust linting (clippy) | ✓ CI-enforced |

The CI gate today is: typecheck passes, rustfmt passes, clippy passes, and the
Windows binary links without error. That catches type-level and style bugs but
not logic bugs.

---

## Running the current checks

```bash
# TypeScript (no emit)
bun run typecheck

# ESLint
bun run lint

# Prettier (check mode)
bunx prettier --check .

# Rust
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
```

All four run in CI on every push. Fix any failures before opening a PR.

---

## Adding Vitest for frontend unit tests

[Vitest](https://vitest.dev) is the natural choice — it reuses the Vite config,
supports jsdom, and has a compatible Jest-like API.

### Setup

```bash
bun add -d vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/user-event
```

Add to `vite.config.ts`:

```ts
import { defineConfig } from "vite"

export default defineConfig({
  // ...existing config
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/lib/**", "src/store/**"],
    },
  },
})
```

Create `src/test/setup.ts`:

```ts
import "@testing-library/jest-dom"
```

Add scripts to `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

### What to test first

Start with pure functions in `src/lib/` — they have no DOM or Tauri
dependencies and are easy to unit-test:

| File | Testable functions |
| --- | --- |
| `lib/format.ts` | String/diff formatters |
| `lib/time.ts` | `relativeTime()` |
| `lib/pane-tree.ts` | Tree manipulation functions |
| `lib/context-usage.ts` | Token accounting math |
| `lib/subagents.ts` | `collectSubagents()` — event log walking |
| `lib/agent-tools.ts` | Tool classifiers and plan content extraction |
| `lib/mentions.ts` | Mention parsing |

Avoid testing Tauri `invoke()` calls in unit tests — those require the desktop
runtime. Mock the IPC layer instead:

```ts
// src/test/mocks/ipc.ts
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}))
```

### Zustand store tests

Store slices are plain functions and can be tested with a real store:

```ts
import { create } from "zustand"
import { createUiSlice } from "../store/slices/ui"

const useStore = create(createUiSlice)

test("sidebar collapsed state", () => {
  const { setSidebarCollapsed, sidebarCollapsed } = useStore.getState()
  expect(sidebarCollapsed).toBe(false)
  setSidebarCollapsed(true)
  expect(useStore.getState().sidebarCollapsed).toBe(true)
})
```

---

## Adding Rust unit tests

Rust tests live in the same files as the code, in `#[cfg(test)]` modules.
Run with:

```bash
cd src-tauri
cargo test
```

### What to test first

| Module | Testable functions |
| --- | --- |
| `store` | Schema migrations, query correctness (use `:memory:` SQLite) |
| `git/diff.rs` | Diff parsing logic |
| `agent/stream.rs` | JSON stream parsing / event normalization |
| `cli/source.rs` | Source preference resolution |
| `workflow/executor.rs` | Topological sort, node ordering |
| `core/util.rs` | `short_id()`, `now_rfc3339()` |

Example in-memory store test pattern:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn test_store() -> Store {
        let conn = Connection::open_in_memory().unwrap();
        let store = Store::from_connection(conn);
        store.migrate().unwrap();
        store
    }

    #[test]
    fn create_and_get_session() {
        let store = test_store();
        // ...
    }
}
```

---

## CI integration

### Adding tests to `ci.yml`

Once tests exist, add a `test` job that runs in parallel with `rust`:

```yaml
test:
  runs-on: ubuntu-latest
  needs: []
  steps:
    - uses: actions/checkout@v4
    - uses: oven-sh/setup-bun@v1
      with:
        bun-version: "1.3.8"
    - run: bun install --frozen-lockfile
    - run: bun run test

rust-test:
  runs-on: ubuntu-22.04
  steps:
    - uses: actions/checkout@v4
    - uses: dtolnay/rust-toolchain@stable
    - uses: actions/cache@v4
      with:
        path: |
          ~/.cargo/registry
          src-tauri/target
        key: ${{ runner.os }}-cargo-test-${{ hashFiles('src-tauri/Cargo.lock') }}
    - run: cargo test --manifest-path src-tauri/Cargo.toml
```

The `build` job should `need` both `test` and `rust-test` so a test failure
blocks the Windows binary from being produced.

### Coverage reporting (optional)

Upload Vitest coverage to Codecov or a similar service:

```yaml
- name: Upload coverage
  uses: codecov/codecov-action@v4
  with:
    files: ./coverage/lcov.info
```

Coverage reporting is most useful as a trend signal — watch for it falling
after large refactors, not as a percentage target.

---

## What we're not testing (and why)

### E2E tests

Tauri E2E tests require a full desktop environment (display server, WebKit).
They're slow, flaky on headless CI, and hard to debug. Not worth the overhead
until the core surfaces stabilize.

The practical substitute is the `build` CI job: it proves the binary compiles
and links. Manual smoke testing with `bun run dev` covers the rest.

### Component tests with Tauri mocks

Components that call `invoke()` are painful to test without a full Tauri
runtime. Short-term: keep logic in `lib/` and store slices (testable), keep
components thin (not worth testing). Long-term: a Tauri test harness or
abstraction layer would enable this.

---

## Principles

- **Test the logic, not the framework.** `invoke()`, Tauri events, and DOM
  interactions are expensive to stub. Pure functions and store reducers are
  cheap to test and where bugs actually live.
- **Tests should run in under 30 seconds.** If the test suite is slow, it won't
  be run locally and won't catch regressions in time.
- **A failing test is a failing build.** Tests that are flaky or skipped are
  noise. Fix or delete them.
- **Don't test implementation details.** Test behavior: given input X, the
  output is Y. Don't assert on internal state that can change without breaking
  the contract.
