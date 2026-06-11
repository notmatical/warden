# Plan 001: Run `cargo test` in CI so the existing Rust tests gate merges

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat c3fb026..HEAD -- .github/workflows/ci.yml`
> If `ci.yml` changed since this plan was written, compare the "Current state"
> excerpt against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `c3fb026`, 2026-06-10

## Why this matters

The repo already contains ~11 Rust unit tests (across 6 modules), but CI never
runs them — the Rust job only checks `fmt` and `clippy`. That means a change can
break a passing test and still merge green. Adding a `cargo test` gate makes the
existing tests (and every test added later, e.g. by plan 002) actually protect
the codebase. This is the cheapest reliability win available and a prerequisite
for the migration-safety work queued as plan 005.

## Current state

- `.github/workflows/ci.yml` — the only CI workflow that runs on every PR. It
  has three jobs: `frontend` (typecheck + biome check), `rust` (fmt + clippy),
  and `build` (Windows, `needs: [frontend, rust]`).
- The `rust` job today, verbatim:

```yaml
  rust:
    name: Rust (fmt + clippy)
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v5
      - name: Install Linux dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
      - uses: swatinem/rust-cache@v2
        with:
          workspaces: "./src-tauri -> target"
      - name: rustfmt
        run: cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
      - name: clippy
        run: cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

- Existing tests live in `#[cfg(test)]` modules in: `src-tauri/src/store/mod.rs`,
  `src-tauri/src/store/migrations.rs`, `src-tauri/src/cli/install.rs`,
  `src-tauri/src/cli/archive.rs`, `src-tauri/src/integrations/linear/binding.rs`,
  `src-tauri/src/integrations/linear/client.rs`.
- Convention: the repo pins commands to the crate via `--manifest-path
  src-tauri/Cargo.toml` (see the `rustfmt`/`clippy` steps above). Match that.

## Commands you will need

| Purpose          | Command                                                              | Expected on success        |
|------------------|---------------------------------------------------------------------|----------------------------|
| Run Rust tests   | `cargo test --manifest-path src-tauri/Cargo.toml`                   | exit 0, all tests pass     |
| Validate YAML    | (none required — the step is plain YAML; CI will parse it)          | —                          |

> Note: the Tauri crate's first compile takes several minutes. If `cargo test`
> appears to hang, it is almost certainly still compiling — wait it out.

## Scope

**In scope** (the only file you should modify):
- `.github/workflows/ci.yml`

**Out of scope** (do NOT touch):
- Any `.rs` file — this plan adds no tests, it only runs the tests that exist.
  (New tests are plan 002.)
- `docs/TESTING.md` — its stale "Rust unit tests: None" claim is corrected by
  plan 003, not here. Do not edit it.
- The `build`, `frontend` jobs and the `release`/`build-*` workflows.

## Git workflow

- Work on the current branch (you are in an isolated worktree).
- Commit message style is Conventional Commits (see `git log --oneline`): use
  `ci: run cargo test in CI`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a `cargo test` step to the `rust` job

In `.github/workflows/ci.yml`, inside the `rust` job's `steps:`, add a test step
**after** the `clippy` step. It reuses the same toolchain and cache already set
up earlier in the job, so no new `uses:` entries are needed — just one `run:`
step:

```yaml
      - name: test
        run: cargo test --manifest-path src-tauri/Cargo.toml
```

Place it as the final step of the `rust` job (after `clippy`). Do not change the
job name, the runner, the dependency install, the toolchain components, or the
cache config.

**Verify**: the `rust` job now ends with `rustfmt` → `clippy` → `test` steps, in
that order. Confirm indentation matches the surrounding steps (6 spaces for the
`- name:` list item).

### Step 2: Confirm the tests actually pass locally

Run the exact command CI will run:

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml` → exit 0, output
ends with one or more `test result: ok.` lines and `0 failed` across the run.

## Test plan

This plan adds no new tests; it wires the existing suite into CI. Verification is
that the existing suite passes under the exact CI command (Step 2).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `.github/workflows/ci.yml` contains a step running `cargo test --manifest-path src-tauri/Cargo.toml` inside the `rust` job
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0 locally with `0 failed`
- [ ] `git status --porcelain` shows only `.github/workflows/ci.yml` modified
- [ ] `plans/README.md` status row for 001 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `rust` job in `ci.yml` no longer matches the "Current state" excerpt
  (someone restructured CI since this plan was written).
- `cargo test` reports any failing test. Do NOT edit the failing test or its
  source to make it pass — report the failure; a pre-existing broken test is a
  finding in its own right.
- `cargo test` fails to compile for a reason unrelated to your one-line change.

## Maintenance notes

- This is an app crate (`package.json` has `"private": true`), so no changeset
  is required for CI-only changes.
- If a future change adds a `test` job to the frontend (Vitest), mirror this
  pattern and add it to the `build` job's `needs:` list so a test failure blocks
  the binary build — `docs/TESTING.md` already sketches this.
- Reviewer should confirm the step runs in the `rust` job (which already has the
  Linux WebKit deps installed) and not in a fresh job missing those deps.
