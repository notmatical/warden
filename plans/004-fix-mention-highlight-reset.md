# Plan 004: Reset the @-mention highlight when the filtered list changes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat c3fb026..HEAD -- src/hooks/use-mentions.ts`
> If `use-mentions.ts` changed since this plan was written, compare the "Current
> state" excerpt against the live code before proceeding; on a mismatch, treat it
> as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `c3fb026`, 2026-06-10

## Why this matters

In the composer's `@`/`/`-mention autocomplete, the keyboard-highlighted item
index (`selectedIndex`) is only reset to 0 **once, on mount**. As the user keeps
typing, the filtered candidate list (`items`) changes, but the highlight does not
move back to the top — so pressing Enter can insert a **stale** item: the one that
sat at the old highlighted index in a now-different list, or nothing if the list
shrank below that index. The effect's own comment says it should "Reset the
highlight as the query or pool changes," but its dependency array is empty, so it
never re-runs. This is a one-line correctness fix to a user-facing input path.

## Current state

- `src/hooks/use-mentions.ts` — the `useMentions` hook backing the composer's
  mention picker. Relevant region:

```ts
// use-mentions.ts:90-98
  const items = useMemo(
    () => (active ? filterMentions(pool, active.query) : []),
    [active, pool]
  )

  // Reset the highlight as the query or pool changes.
  useEffect(() => {
    setSelectedIndex(0)
  }, [])
```

  - `items` (line 90) is the filtered list the picker renders; it recomputes when
    `active` (the in-progress mention, incl. its `query`) or `pool` changes.
  - `selectedIndex` is `useState(0)` (line 51); `setSelectedIndex` is its stable
    setter.
  - The effect at line 96-98 is the bug: deps `[]` ⇒ runs only on mount.

- Lint config (`biome.json`): `useExhaustiveDependencies` is `"warn"`, and
  `package.json`'s `check` script (`biome check …`) is **not** run with
  `--error-on-warnings`, so a warning does not fail `bun run check`. (Good to know
  for Step 2.)
- There is a stray `// eslint-disable-next-line react-hooks/exhaustive-deps` at
  line 87 (above a *different* effect, the pool-loader). It is inert under Biome.
  You MAY delete that single comment line as a tidy-up since you're in this file,
  but do not otherwise change the pool-loader effect.

## Commands you will need

| Purpose     | Command              | Expected on success |
|-------------|----------------------|---------------------|
| Typecheck   | `bun run typecheck`  | exit 0, no errors   |
| Biome check | `bun run check`      | exit 0              |

## Scope

**In scope** (the only file you should modify):
- `src/hooks/use-mentions.ts`

**Out of scope** (do NOT touch):
- Any other hook/effect in this file beyond the highlight-reset effect (and the
  optional one-line `eslint-disable` comment deletion noted above).
- `src/lib/mentions.ts`, the composer component, or anything rendering the picker.
- Do NOT change the `items` memo, `selectedIndex`'s initial value, or
  `handleKeyDown`/`select`.

## Git workflow

- Work on the current branch (isolated worktree).
- Conventional Commits: `fix(mentions): reset highlight when filtered list changes`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Make the reset effect depend on the filtered list

Change the highlight-reset effect's dependency array from `[]` to `[items]`:

```ts
  // Reset the highlight to the top whenever the filtered list changes, so Enter
  // never selects a stale item from a previous query.
  useEffect(() => {
    setSelectedIndex(0)
  }, [items])
```

(`items` is the right trigger: it is exactly the rendered list and already
recomputes from `active`/`pool`, matching the original comment's "query or pool
changes" intent.)

**Verify**: the effect now lists `[items]`; no other code changed.

### Step 2: Typecheck and lint

**Verify**:
- `bun run typecheck` → exit 0.
- `bun run check` → exit 0. (Biome may print a `useExhaustiveDependencies`
  *warning* about this effect; that does not fail the command. ONLY if it does
  surface a warning and you want a clean report, add a single line directly above
  the `useEffect`:
  `// biome-ignore lint/correctness/useExhaustiveDependencies: reset trigger, value intentionally unused in body`
  — do not change the deps array to satisfy it.)

## Test plan

- **Automated**: none in this plan — the frontend has no test runner configured
  (no Vitest, no `test` script). Standing up Vitest is a separate, larger effort
  (sketched in `docs/TESTING.md`) and is out of scope for this one-line fix.
- **Manual verification** (record the result in your report):
  1. `bun run dev` (or `bun run dev:web` for UI-only).
  2. In a session composer, type `@` to open the file-mention picker.
  3. Press Down a few times to move the highlight off the first item.
  4. Type another character to narrow the list.
  5. Confirm the highlight returns to the **top** item, and pressing Enter inserts
     that top item — not a stale one. Before this fix, the highlight stays put and
     Enter can insert the wrong file.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] The highlight-reset `useEffect` in `src/hooks/use-mentions.ts` has deps `[items]` (was `[]`)
- [ ] `bun run typecheck` exits 0
- [ ] `bun run check` exits 0
- [ ] `git status --porcelain` shows only `src/hooks/use-mentions.ts` modified
- [ ] `plans/README.md` status row for 004 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `use-mentions.ts` no longer matches the "Current state" excerpt (the hook was
  refactored since this plan was written — e.g. `selectedIndex` reset moved
  elsewhere).
- `bun run typecheck` or `bun run check` reports an **error** (not a warning)
  after your change.
- You find the highlight reset is already handled somewhere else (e.g. inside
  `handleInput` or `setActive`) such that this effect is redundant — report what
  you found instead of making the change.

## Maintenance notes

- App crate (`"private": true`) — no changeset needed.
- When frontend tests land (Vitest per `docs/TESTING.md`), add a hook test for
  `useMentions` asserting `selectedIndex` returns to 0 after `items` changes —
  this is exactly the kind of pure-ish state logic that doc says to cover first.
- Reviewer should confirm the dependency is `items` (the rendered list) and not
  `[active]` or `[pool]` alone — `items` is the value the picker actually renders,
  so it's the correct, minimal trigger.
