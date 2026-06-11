# Plan 003: Correct the docs to reflect Biome and remove the dead ESLint/Prettier config

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat c3fb026..HEAD -- README.md docs/TESTING.md docs/BUNDLE-OPTIMIZATION.md eslint.config.js .prettierrc .prettierignore package.json`
> If any of these changed since this plan was written, compare the "Current
> state" facts against the live files before proceeding; on a mismatch, treat it
> as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `c3fb026`, 2026-06-10

## Why this matters

The repo's linter/formatter is **Biome** (`biome.json`; `package.json` scripts
`lint`/`check`/`format` all call `biome`). But the docs still tell contributors to
run ESLint and Prettier, and the repo still carries `eslint.config.js`,
`.prettierrc`, and `.prettierignore` — none of which are wired to anything
(`package.json` has no `eslint`/`prettier` dependency or script). A new
contributor (or an automated executor following a plan's verification commands)
who runs `bunx prettier --check .` or tries to fix "ESLint errors" wastes time on
a toolchain that isn't there. This plan makes the docs match reality and deletes
the dead config so nobody trusts it again. It also corrects the stale "Rust unit
tests: None" line in `TESTING.md` (the repo has ~11 Rust tests).

## Current state

Verified facts (confirm with the drift check before editing):

- **Real toolchain**: `biome.json` exists. `package.json` scripts:
  - `"lint": "biome lint src/ scripts/ vite.config.ts"`
  - `"check": "biome check src/ scripts/ vite.config.ts"`
  - `"format": "biome format --write src/ scripts/ vite.config.ts"`
  - There is **no** `eslint` or `prettier` dependency and no `test` script.
- **Dead files** (referenced by nothing in `package.json`/CI):
  - `eslint.config.js` — imports `@eslint/js`, `eslint/config`,
    `eslint-plugin-react-hooks`, etc., none of which are installed.
  - `.prettierrc`, `.prettierignore`.
- **Wrong docs**:
  - `README.md:86-87` — Scripts table:
    - `` | `bun run lint` | ESLint. | `` → should describe Biome lint.
    - `` | `bun run format` | Prettier. | `` → should describe Biome format.
  - `docs/TESTING.md:19` — `` | Linting (ESLint + Prettier) | ✓ CI-enforced | ``.
  - `docs/TESTING.md:33-46` — "Running the current checks" block shows
    `# ESLint` / `bun run lint` and `# Prettier (check mode)` / `bunx prettier
    --check .`.
  - `docs/TESTING.md:14` — `` | Rust unit tests | None | `` (stale: ~11 tests exist
    in `store/mod.rs`, `store/migrations.rs`, `cli/install.rs`, `cli/archive.rs`,
    `integrations/linear/binding.rs`, `integrations/linear/client.rs`).
  - `docs/BUNDLE-OPTIMIZATION.md:49` — references "functions in `.prettierrc`".
- **CI** (`.github/workflows/ci.yml`) already runs `bun run check` (Biome) in the
  `frontend` job — so CI is correct; only the docs and dead files are wrong.
- **Stray comment**: `src/hooks/use-mentions.ts:87` has an
  `// eslint-disable-next-line react-hooks/exhaustive-deps`. Leave it — that file
  is owned by plan 004. Do not edit `use-mentions.ts` in this plan.

## Commands you will need

| Purpose                | Command                                                              | Expected on success            |
|------------------------|----------------------------------------------------------------------|--------------------------------|
| Biome check (frontend) | `bun run check`                                                      | exit 0                         |
| Typecheck              | `bun run typecheck`                                                  | exit 0                         |
| Find stale refs        | `git grep -niE "eslint|prettier"`                                   | only the intended remaining hits (see Done) |

## Scope

**In scope** (modify / delete only these):
- `README.md` (edit lines 86-87)
- `docs/TESTING.md` (edit the lint row, the "Running the current checks" block, and the Rust-tests row)
- `docs/BUNDLE-OPTIMIZATION.md` (fix the `.prettierrc` reference)
- `eslint.config.js` (delete)
- `.prettierrc` (delete)
- `.prettierignore` (delete)

**Out of scope** (do NOT touch):
- `package.json` — its scripts are already correct (Biome). Do not add a `test`
  script here; that's tracked separately.
- `biome.json` — already correct.
- `.github/workflows/ci.yml` — already runs Biome; plan 001 owns CI edits.
- `src/hooks/use-mentions.ts` — owned by plan 004 (leave the `eslint-disable`
  comment for now).
- Any source file under `src/` or `src-tauri/`.
- Tailwind class-sorting behavior — see Maintenance notes; do not try to add a
  Biome class-sorting rule in this plan.

## Git workflow

- Work on the current branch (isolated worktree).
- Conventional Commits: `docs: replace ESLint/Prettier references with Biome` (you
  may split the deletions into a second commit `chore: remove dead eslint/prettier
  config` if you prefer).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Fix the README Scripts table

In `README.md`, change the two rows (around lines 86-87):

- `| `bun run lint` | ESLint. |` → `| `bun run lint` | Biome lint. |`
- `| `bun run format` | Prettier. |` → `| `bun run format` | Biome format (writes changes). |`

(There is also a `| `bun run typecheck` | …` row nearby — leave it as is.)

**Verify**: `git grep -niE "eslint|prettier" README.md` → no matches.

### Step 2: Fix `docs/TESTING.md`

- Line ~19, the status table row:
  `| Linting (ESLint + Prettier) | ✓ CI-enforced |`
  → `| Linting + formatting (Biome) | ✓ CI-enforced |`
- Line ~14, the Rust tests row:
  `| Rust unit tests | None |`
  → `| Rust unit tests | A few (store, migrations, cli, linear); not yet exhaustive |`
- The "Running the current checks" block (lines ~33-46): replace the ESLint and
  Prettier subsections with the actual Biome command. Target shape:

```bash
# TypeScript (no emit)
bun run typecheck

# Biome (lint + format check)
bun run check
```

  Keep the Rust subsection (`cargo fmt --check`, `cargo clippy …`) as it is. If
  that block lists the CI gate, you may also add `cargo test` to reflect plan 001
  — but only if plan 001 has landed; otherwise leave the Rust commands unchanged.

**Verify**: `git grep -niE "eslint|prettier" docs/TESTING.md` → no matches.

### Step 3: Fix the `.prettierrc` reference in BUNDLE-OPTIMIZATION.md

In `docs/BUNDLE-OPTIMIZATION.md:49`, the sentence references Tailwind functions
configured in `.prettierrc`. Reword it so it no longer points at a deleted file —
describe the intent generically (e.g. that Tailwind class ordering is handled by
the formatter) without naming `.prettierrc`. Keep the surrounding paragraph's
meaning intact; change only the clause that names the file.

**Verify**: `git grep -ni "prettierrc" docs/BUNDLE-OPTIMIZATION.md` → no matches.

### Step 4: Delete the dead config files

Delete `eslint.config.js`, `.prettierrc`, and `.prettierignore`.

**Verify**:
- `ls eslint.config.js .prettierrc .prettierignore 2>/dev/null` → all three absent.
- `bun run check` → exit 0 (Biome doesn't depend on these).
- `bun run typecheck` → exit 0.

### Step 5: Final stale-reference sweep

**Verify**: `git grep -niE "eslint|prettier"` returns **only** this one expected
remaining hit:
- `src/hooks/use-mentions.ts:87:    // eslint-disable-next-line react-hooks/exhaustive-deps`
  (intentionally left for plan 004).

If `git grep` shows any other hit (in docs, config, or `CHANGELOG.md`), inspect
it; CHANGELOG history entries may legitimately mention the old tools — if so,
leave `CHANGELOG.md` untouched and note it.

## Test plan

No automated tests (docs + config deletion). Verification is the `git grep`
sweeps in each step plus `bun run check` / `bun run typecheck` staying green after
the deletions.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `git grep -niE "eslint|prettier" README.md docs/TESTING.md docs/BUNDLE-OPTIMIZATION.md` → no matches
- [ ] `eslint.config.js`, `.prettierrc`, `.prettierignore` no longer exist
- [ ] `bun run check` exits 0
- [ ] `bun run typecheck` exits 0
- [ ] `git grep -niE "eslint|prettier"` → at most the single `use-mentions.ts:87` comment (and possibly `CHANGELOG.md` history, left intact)
- [ ] `git status --porcelain` shows only the in-scope files modified/deleted
- [ ] `plans/README.md` status row for 003 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `package.json` turns out to actually have an `eslint`/`prettier` dependency or a
  script that invokes them (the "Current state" facts would be wrong — the
  toolchain may have changed since this plan was written).
- `bun run check` fails *after* deleting the files (something did depend on them —
  unexpected; report it rather than recreating the files blindly).
- `git grep` reveals an ESLint/Prettier reference in a build script or CI file you
  were told is out of scope — report it; don't expand scope on your own.

## Maintenance notes

- App crate (`"private": true`) — no changeset needed for docs/config changes.
- **Tailwind class sorting**: the old setup may have sorted Tailwind class lists
  via a Prettier plugin (`.prettierrc`). Biome can do this with its
  `useSortedClasses` rule, but enabling it is a separate decision (it can produce
  a large reformatting diff). This plan intentionally does NOT enable it — if the
  team wants class sorting back, configure it in `biome.json` as a follow-up.
- The stray `eslint-disable` comment in `src/hooks/use-mentions.ts` is inert under
  Biome; plan 004 touches that file and can remove it there.
- Reviewer should confirm no source behavior changed — this is docs + deletion of
  unused config only.
