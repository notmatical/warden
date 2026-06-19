# Monorepo + crate-split migration

Tracking doc for warden's move to a bun + Cargo workspace, modeled on modrinth
(`_refs/modrinth-monorepo`). Living checklist — check files off as they port.

## Goal

Split the single Tauri package into a **Tauri-agnostic core crate** + a **thin
shell crate**, then restructure the repo into workspaces so a future website can
share infrastructure. Crate split first (real architectural payoff, no JS
churn), monorepo restructure second, shared packages later.

## Locked decisions

- **`warden-core` is ONE crate**, modules inside (`session/`, `workflow/`, `store/`,
  `git/`, `providers/`, …) mirroring theseus. The shell (`warden`) is a second
  crate. That's the whole workspace for now — warden's roadmap (a JS website)
  shares no Rust, so nothing earns a third crate yet. Crates split along *reuse
  boundaries*, never domains.
- **Tauri-optional feature** (modrinth's exact approach): `warden-core` depends on
  `tauri = { optional = true }` behind a `tauri` feature; the shell enables it.
  Mirror theseus's global `EventState` (`OnceCell<AppHandle>`, `#[cfg(feature =
  "tauri")]`-gated): store the handle once at startup, drop the `&AppHandle`
  threading through agent/workflow/git that only carried it for events.
- **One `tauri-specta` Builder** → one auto-generated `bindings.ts` (a warden
  strength modrinth lacks). Per-domain organization comes from moving thin
  `#[tauri::command]` wrappers into `commands/<domain>.rs` and referencing them by
  module path in a single grouped `collect_commands![]`. NOT literal
  one-plugin-per-domain (`.plugin_name()`) — that fragments the typed bindings.
- **Workspaces**: bun (JS) + Cargo (Rust). Pure Rust → `crates/`, JS → `packages/`,
  apps → `apps/`. `apps/web` is a placeholder scaffold; shared `packages/ui` +
  `packages/tooling-config` are deferred until the website needs them.
- **DB stays `rusqlite`** — no ORM. Diesel is too much ceremony for a single-user
  embedded DB; SQLx (what theseus uses) was considered but its compile-time-checked
  queries need a build-time DB + offline cache (`SQLX_OFFLINE`/`.sqlx`) and an async
  rewrite — not worth it here. The store's boilerplate is solved with targeted
  rusqlite helpers instead (see Deferred). The store ports **verbatim** during the
  split; any cleanup is a separate post-split commit.

## Porting conventions

- **Parallel clean-build.** `src-tauri` stays frozen and untouched — the working
  reference and the running app until cutover. `warden-core` is built up as a clean
  replacement; **no re-export shims or compat code ever land in the doomed shell.**
- **Clean up as we go.** Each file/module enters `warden-core` in its best form —
  behavioral cleanups (structured errors, `strum` enums, provider registry, store
  helpers, `Session` decomposition) are applied *during* its port, reviewed
  file-by-file. Cross-cutting refactors land when their module ports (e.g. the
  provider registry arrives with `providers/`).
- **Reviewable steps.** One file/module per step: show current code + proposed clean
  version → approve → write → `cargo check -p warden-core` (+ `cargo test`) → check off.
- **Cutover (end).** Build the thin shell against `warden-core` (command wrappers,
  builder, Tauri-resident bits), verify the full app + `bindings.ts`, then delete the
  replaced fat modules from `src-tauri` in one pass.
- **No central type module.** `domain/` dissolves. Types live with the module that
  owns their behavior (`Workflow*`→`workflow/`, `Group`/`Project`/`Label`→
  `workspace/`, `Session`+state enums→`session/`). warden-core is one crate, so
  intra-crate module cycles are free — colocation costs nothing.
- **Type-file naming: `types.rs` per module.** Each feature module = `mod.rs` (glue
  + re-exports) + `types.rs` (its data) + behavior files. Not `model.rs` — "model"
  already means the LLM model in warden (`session.model`, `model_config.rs`,
  `lib/models.ts`), so it would collide. Core pillars keep concept names
  (`core/backend.rs`); `core/mod.rs` re-exports so call sites use `warden_core::Backend`.
- **`core/` holds pillars, not features.** The cross-cutting kernel no single
  feature owns: the event contract (`AgentEvent` & friends) and the
  *agent-invocation vocabulary* (`Backend`, `PermissionMode`, `EffortLevel`) — the
  inputs handed to a provider to run a turn. Rule: `core/` = vocabulary for
  invoking agents; feature modules = the state of features. Keeps `providers/`
  depending only on the core floor, never up on `session/`.
- **Dependency order, leaves first** — each tier compiles against already-ported
  tiers.
- **Per-module cadence**: review files → agree on any change → port → check off.
- Destination key: `core` = moves to warden-core · `shell` = Tauri-resident
  (commands, `State`, plugins, `Channel`) · `core*`/`shell*` = leans that way,
  confirm during that tier's review · `split` = logic→core, wrappers→shell.

## Target layout

```
warden/
├─ Cargo.toml              # [workspace] members = crates/*, apps/desktop/src-tauri
├─ package.json            # private root; workspaces: apps/*, packages/*
├─ rust-toolchain.toml rustfmt.toml clippy.toml   # NEW (Phase 2)
├─ apps/
│  ├─ desktop/             # @warden/desktop — src/ + src-tauri/ (crate `warden`)
│  │  └─ src-tauri/src/{lib.rs, commands/<domain>.rs}
│  └─ web/                 # placeholder scaffold
└─ crates/
   └─ warden-core/         # crate `warden_core`
```

---

## Phase 1 — Cargo workspace + crate split

App stays at repo root during Phase 1; only the Rust crate boundary changes.

### Tier 0 — scaffold + type layer (dissolve `domain/`)

- [x] **Scaffold**: root `Cargo.toml` `[workspace]`; `crates/warden-core` with
      `tauri` optional feature; `src-tauri` depends on `warden-core` (feature on).
      Verified: `cargo check -p warden-core` green (no Tauri); shell builds in workspace.
- [x] `domain/event.rs` → **`core/event/types.rs`** — `AgentEvent`, `EventRecord`,
      `TokenUsage`, `ToolDenial` (cross-backend contract; pairs with emit machinery).
      Shim: `domain/mod.rs` re-exports from `warden_core`. Verified green.
- [ ] `domain/session.rs` enums → split: `Backend`, `PermissionMode`, `EffortLevel`
      → **`core/backend.rs`** + **`core/turn.rs`** (agent-invocation vocabulary);
      `SessionStatus`, `SessionKind`, `SessionRole`, `SetupStatus`, `CheckStatus`,
      `PrCheckCounts` → **`session/types.rs`**
- [ ] `domain/session.rs` `Session` struct → **`session/types.rs`** *(40-field; decomp deferred)*
- [ ] `domain/context.rs` → **`session/types.rs`** (`ContextSource`, `SessionContextSource`)
- [ ] `domain/workflow.rs` → **`workflow/types.rs`** (all `Workflow*` types)
- [x] `domain/group.rs`, `domain/project.rs`, `domain/label.rs` → **`workspace/types.rs`**
      (3→1 consolidation; originals retained as reference). Verified green.
- [ ] delete `domain/mod.rs` (module dissolved); fix re-export sites
- [ ] `core/error.rs` — `core` (AppError / CommandResult)
- [ ] `core/util.rs` — `core`
- [ ] `core/model_config.rs` — `core`
- [ ] `core/platform.rs` — `core*` (linux webview env workarounds; verify no Tauri)

### Tier 1 — foundation

- [ ] `store/migrations.rs` — `core`
- [ ] `store/mod.rs` — `core` (1728 lines, pure rusqlite)
- [ ] `core/events.rs` → `core/event/` — `core` (feature-gated global `EventState`)
- [ ] `cli/paths.rs` — `core`
- [ ] `cli/source.rs` — `core`
- [ ] `cli/archive.rs` — `core`
- [ ] `cli/mod.rs` — `core`
- [ ] `cli/install.rs` — `core*` (emits install progress → `EventState`)

### Tier 2 — logic

- [ ] `git/cli.rs` — `core`
- [ ] `git/diff.rs` — `core`
- [ ] `git/worktree.rs` — `core`
- [ ] `git/setup.rs` — `core*` (spawns bg tasks + emits; verify after EventState)
- [ ] `mentions/commands.rs` — `split` (file enumeration→core, wrappers→shell)
- [ ] `providers/mod.rs` — `core`
- [ ] `providers/context.rs` — `core`
- [ ] `providers/jsonrpc.rs` — `core`
- [ ] `providers/claude/{mod,agent,auth,download,history}.rs` — `core`
- [ ] `providers/codex/{mod,agent,auth,download,history}.rs` — `core`
- [ ] `providers/opencode/{mod,agent,auth,download,history,models,server}.rs` — `core`
- [ ] `integrations/github/{mod,token,download,issues,pr,pr_content}.rs` — `core`
- [ ] `integrations/github/poll.rs` — `shell*` (uses `app.state()`; spawn → shell)
- [ ] `integrations/linear/{mod,key,binding,client,sync,writeback}.rs` — `core`
- [ ] `integrations/linear/poll.rs` — `shell*`
- [ ] `integrations/mod.rs` — `core`

### Tier 3 — orchestration

- [ ] `agent/attachments.rs` — `core`
- [ ] `agent/naming.rs` — `core`
- [ ] `agent/oneshot.rs` — `core`
- [ ] `agent/recipes.rs` — `core`
- [ ] `agent/stream.rs` — `core`
- [ ] `agent/mod.rs` — `core` (AgentManager)
- [ ] `agent/session_proc.rs` — `core*` (process registry + reattach; verify seam)
- [ ] `workflow/events.rs` — `core` (feature-gated)
- [ ] `workflow/executor.rs` — `core` (drop `AppHandle` from `RunContext` → `EventState`)
- [ ] `workflow/mod.rs` — `core`
- [ ] `terminal/pty.rs` — `core`
- [ ] `terminal/registry.rs` — `core`
- [ ] `workspace/config.rs` — `core`

### Shell-resident (stay in `src-tauri`, thin wrappers)

- [ ] `core/state.rs` — `shell` (AppState: store + manager + focus)
- [ ] `core/poll_tier.rs` — `shell` (`#[tauri::command]` + focus state)
- [ ] `core/external.rs` — `shell` (tauri_plugin_opener)
- [ ] `terminal/commands.rs` — `shell` (IPC `Channel`)
- [ ] `session/commands.rs` → `commands/session.rs` — `shell` (679 lines; extract inline logic to core where clean)
- [ ] `workspace/commands.rs` → `commands/workspace.rs` — `shell`
- [ ] `git/commands.rs` → `commands/git.rs` — `shell`
- [ ] `workflow/commands.rs` → `commands/workflow.rs` — `shell`
- [ ] `agent/commands.rs` → `commands/agent.rs` — `shell`
- [ ] `providers/commands.rs` → `commands/providers.rs` — `shell`
- [ ] `mentions/commands.rs` (wrappers) → `commands/mentions.rs` — `shell`
- [ ] `integrations/github/commands.rs` → `commands/integrations/github.rs` — `shell`
- [ ] `integrations/linear/commands.rs` → `commands/integrations/linear.rs` — `shell`
- [ ] `lib.rs` — rebuild: builder + grouped `collect_commands!` + setup wiring

### Phase 1 gate

- `cargo build -p warden-core` with **no** `tauri` feature compiles (proves decoupling)
- `cargo build` + `cargo test` pass
- `bun run dev` regenerates a byte-identical `bindings.ts`; app launches; a session
  runs end-to-end (events flow); a workflow run completes

## Phase 2 — toolchain pins

- [ ] `rust-toolchain.toml`, `rustfmt.toml`, `clippy.toml` (+ optional `typos`)

## Phase 3 — JS monorepo restructure (bun workspaces)

- [ ] Root `package.json` workspaces; app deps → `apps/desktop/package.json`
- [ ] Move `src/`, `src-tauri/`, `vite.config.ts`, html, configs → `apps/desktop/`
      (root `Cargo.toml` members repoint to `apps/desktop/src-tauri`)
- [ ] Path fixups: `tauri.conf.json`, `.github/workflows/*`, `scripts/*.mjs`,
      `.changeset/config.json`, `.warden/config.json`, `tsconfig.*`, vite watch
- [ ] Scaffold `apps/web/` placeholder
- [ ] Gate: `bun install` resolves; desktop `dev`/`build` work; CI green (Windows min)

## Phase 4 — shared packages (deferred until website exists)

- [ ] Extract `packages/tooling-config` (shared biome + tsconfig base)
- [ ] Extract `packages/ui` (React components shared by app + web)
- [ ] Optional: `turbo` once build times justify it

---

## Cleanup catalog (applied during each module's port — clean up as we go)

Not deferred anymore — each lands while its module ports into `warden-core`, reviewed
file-by-file. Listed here as the catalog of what to clean and where it applies.

- **Provider extensibility (`Provider` trait + registry)** — `Backend` conflates
  identity with dispatch, so every behavior is a `match backend {…}` scattered
  across **14 files / 60 sites**, doubled by a shadow `cli::Tool` enum and 19
  hand-maintained refs in `src/lib/models.ts`. Adding a provider (Cursor, …) today
  touches ~10 sites across two languages. Plan (**hybrid**): keep `Backend` as a
  typed enum *identity* (serialization + UI-facing exhaustive matches); move all
  behavior behind `trait Provider { id, cli_tool, handles_model, fast_model, run,
  is_authed, install, history, … }` collected in a registry keyed by `Backend`.
  Folds `cli::Tool`'s provider variants into the trait (`Tool::Gh` stays — it's an
  integration dep, not a backend); makes the frontend provider list data-driven via
  one command. Startup assertion: every `Backend::ALL` has a registered `Provider`
  (recovers completeness as a test). Resting places decided now: trait + registry +
  adapters in `providers/`, `Backend` identity in `core/`. Cursor then = adapter
  impl + register + one enum line + one icon (~3 sites). Not full `ProviderId(String)`
  — no out-of-tree providers to justify losing typed safety; hybrid→full is easy later.
- **Enum string-conversion boilerplate** — 8 enums hand-roll `as_str` + `parse`,
  duplicating `#[serde(rename_all)]` (two sources of truth, ~100 lines). The store
  round-trips them as `TEXT`, which is why they exist. Plan (rusqlite stays): impl
  `rusqlite` `ToSql`/`FromSql` so `store/` consumes the enums directly (deletes the
  DB call sites), and collapse the remaining `as_str`/`parse` with `strum`
  (`EnumString` + `IntoStaticStr`) or a small local macro for one declarative source.
- **Store cleanups (rusqlite)** — staying on `rusqlite`, the boilerplate in the
  1728-line `store/mod.rs` is cut without a stack swap: `serde_rusqlite` (or a small
  `FromRow` helper) to kill manual column→field mapping, and `rusqlite_migration` to
  replace the hand-rolled `migrations.rs` runner with a tested one. Pairs with the
  enum `ToSql`/`FromSql` work above.
- **`Session` struct decomposition** — 40 flat fields mixing identity + terminal +
  PR/CI + Linear + workflow clusters. Candidate: fold `pr_*` into an optional
  nested `PrStatus` (like `PrCheckCounts` already is). Reshapes `bindings.ts` + the
  frontend, so it's its own conversation well after the split.
