# Linear Integration — Approach

## Context

The global **Tasks** destination is a placeholder today ([`tasks-view.tsx`](../src/components/tasks-view.tsx) — a `DestinationEmpty` with a disabled "Connect Linear — coming soon" button). The goal is bi-directional Linear sync, in the spirit of Superset's integration, so a user can triage and work Linear issues without leaving warden.

Two structural tensions shape the design:

1. **Warden's structure is free-form and repo-centric, Linear's is org-centric.** Warden has `Group` (a loose workspace, often just *reference folders for AI context*) → `Folder/Root` (a git repo, many-to-many with groups) → `Session`. Linear has `Workspace` → `Team` (owns workflow states) → `Project` (initiative) → `Issue`. A warden group frequently has **no** meaningful Linear counterpart.

2. **Warden is a Tauri desktop app; Superset is hosted SaaS.** Superset's sync leans on a public API endpoint (Linear **webhooks**), a hosted queue (**QStash**) for outbound + token refresh, and multi-tenant OAuth. Warden has none of these: no public endpoint for webhooks to reach, no always-on server (sync runs only while the app is open), and **can't safely embed an OAuth client secret** in a distributed binary.

### Decisions locked (with the user)

| Decision | Choice | Rationale |
|---|---|---|
| Tasks scope | **Global inbox + optional bindings** | One filterable list of synced issues; bindings are optional convenience, never a hard partition. Fits free-form groups. |
| Binding unit | **Repo/folder** (not group) | A repo is a codebase; Linear work is "things to do on a codebase." Groups stay loose. |
| Binding storage | **Committable `.warden/config.json`** | A team/project id is an identifier, not a secret; "this repo → this Linear team" belongs to the repo and should travel with it (a teammate who clones gets it for free). Keyed by repo path → no group↔repo ambiguity. |
| Credential | **One global personal API key, in the OS keychain** | Linear has no team-scoped tokens (see below); per-group keys are pointless. Single-user desktop app → personal key beats OAuth. |
| v1 scope | **Connection + read-only inbox** | Validate the sync engine before adding writeback. |

### The auth insight that drives everything

**Linear has no team-scoped or project-scoped tokens.** A personal API key grants access to everything the user can see; OAuth scopes are *permission-type* (`read`, `write`, `issues:create`, `admin`), not *resource-type*. There is no token that "only sees Team X." So **credential and scope are decoupled**: the credential is global, and scoping is *our* client-side config (which teams/projects a binding pulls), never a property of the token. This is exactly where Superset is heading with its unshipped team-linkage plan — we start there instead.

> Verify against current Linear docs before implementing: personal-API-key auth header format and current rate-limit model. These are load-bearing but external.

---

## Architecture — a layered model

Binding is **optional and sparse**. Most groups never bind anything.

**Layer 1 — Global connection + global inbox (the 80% value, zero binding).**
One personal API key → Tasks becomes a global, filterable inbox of the user's Linear issues (default filter: assigned to me + active). Filters: team / project / status / assignee / label. Works for everyone, including context-only groups. This alone justifies the feature and **is v1**.

**Layer 2 — Optional repo ↔ Linear binding (primary binding unit, P3).**
On a folder/repo, an optional *"Linked Linear team"* (narrowable by project). When set, that repo's view gets a scoped Tasks panel — and unlocks the differentiator:

> Drag an issue → **start an agent session or workflow from it**: pre-fill the branch (`feature/war-123`), seed the prompt with the issue's title + description, and on commit/PR write the status back ("In Progress" → "In Review"). The issue becomes the entry point to agent work, and progress flows back.

This issue→session→workflow→writeback loop is what Superset structurally can't do, and it ties Linear into warden's existing repo + session + [workflow](../src/store/slices/workflows.ts) model.

**Layer 3 — Optional group "saved view" (convenience only, P4).**
A group can optionally store a Linear saved-view/filter so opening Tasks "from" that group pre-applies it. No data partition; context-only groups leave it unset. This is the literal implementation of "global inbox + optional bindings."

**Team vs Project:** bind primarily to a **Team** (teams own workflow states → clean status mapping + clear "this codebase's tracker"), narrowable by **Project**. Groups bind to a **saved view** when they bind at all.

---

## Sync mechanics (desktop-shaped)

**Contrast with Superset (it's the inverse of ours).** Superset *doesn't poll for data* — inbound is **webhooks** (real-time) plus a one-time initial sync on connect; the only scheduled job is **OAuth token refresh** (a QStash cron scanning a 90-min expiry horizon + a lazy refresh-on-use with a 5-min buffer, [`linear/utils.ts:54–78`](../_refs/superset/packages/trpc/src/router/integration/linear/utils.ts)). Warden inverts both halves and comes out **simpler**: we *must* poll for data (no webhook endpoint on a desktop app), but we have **no token refresh at all** (personal API keys are long-lived, unlike OAuth tokens). We drop Superset's entire refresh subsystem, QStash, and webhook receiver — net result is one poll loop + direct mutations.

- **Inbound — poll, not webhooks.** A background Tokio task polls while the app is open, mirroring [`github/poll.rs`](../src-tauri/src/github/poll.rs) (spawned at [`lib.rs:211`](../src-tauri/src/lib.rs), 60s `tokio::time::interval`). Incremental query: `issues(filter: { updatedAt: { gt: $lastSyncedAt } }, first: 100, orderBy: updatedAt)`, paginated; upsert into a local cache; advance the `updatedAt` cursor. Also refresh on window focus and on a manual refresh button.
- **Outbound — optimistic + last-write-wins (P2+).** Store update is optimistic; the mutation runs in the Rust backend via `reqwest`. Add an `updatedAt` guard (refetch/warn if Linear's `updatedAt` is newer than our base) — slightly safer than Superset, which has none.
- **Identity.** Store Linear `id` (UUID) + `identifier` (e.g. `WAR-123`) per cached row; upsert by `id`.
- **Caching.** Issues live in SQLite so the inbox is instant and offline-capable; the renderer reads cache and is refreshed via a Tauri event when the poll detects changes (same change-detect-then-emit shape as `poll_once` in `github/poll.rs`).

Real-time webhooks would need a hosted relay — explicitly out of scope.

---

## Auth & Linear API specifics

- **Endpoint:** `https://api.linear.app/graphql` (single GraphQL endpoint).
- **Auth header (personal API key):** `Authorization: <key>` — the raw key, **not** `Bearer`. (OAuth tokens use `Bearer`; we are not using OAuth.) This differs from the `bearer_auth(...)` used in [`cli/archive.rs:42`](../src-tauri/src/cli/archive.rs) for GitHub — use a plain `.header("Authorization", key)`.
- **Raw GraphQL via `reqwest` for everything.** There's no official Rust Linear SDK (`@linear/sdk` is TS-only), and warden does integration HTTP in the Rust backend anyway (keeping the key out of the renderer). Use hand-written query strings + `serde` structs, reusing the `http_client()` builder from [`cli/archive.rs:13`](../src-tauri/src/cli/archive.rs).
  - *Why this is the right path, not a compromise:* Superset uses the SDK for mutations/small lookups but **deliberately drops to raw GraphQL for the bulk issue read** ([`initial-sync/utils.ts:85–152`](../_refs/superset/apps/api/src/app/api/integrations/linear/jobs/initial-sync/utils.ts)) — the SDK's `client.issues()` returns lazy connections that fire N+1 round-trips for nested `assignee`/`state`/`labels`. Writing raw GraphQL avoids that trap by construction. **Reuse Superset's `ISSUES_QUERY` field set verbatim** as warden's query shape; their initial-sync filter `{ updatedAt: { gte: … } }` is our incremental poll filter as `{ updatedAt: { gt: lastSyncedAt } }`.
- **Credential storage:** OS keychain via the `keyring` crate (Windows Credential Manager / macOS Keychain / Linux Secret Service). This is a deliberate hardening step over the plaintext `settings` table ([`store/mod.rs:1076`](../src-tauri/src/store/mod.rs)) — a Linear key is full-workspace access. Non-secret config (sync cursor, bindings, default filter) can stay in `settings` or a small new table.
- **Rate limits:** Linear rate-limits by query complexity. One paginated `issues` query per 60s poll is comfortably within budget; confirm the current published limit before shipping.

---

## Data model

**Cache table (new) — `linear_issues`:** `id` (PK, Linear UUID), `identifier`, `title`, `description`, `priority`, `estimate`, `due_date`, `state_id`, `state_name`, `state_type`, `state_color`, `team_id`, `team_key`, `assignee_id`, `assignee_name`, `assignee_email`, `assignee_avatar_url`, `project_id`, `project_name`, `labels` (JSON), `url`, `started_at`, `completed_at`, `updated_at`, `synced_at`. Add a migration following the versioned PRAGMA pattern in `migrations.rs`.

**Connection state:** `linear_api_key` → keychain; `linear_last_synced_at` cursor + `linear_connected` flag → `settings` KV.

**Field mapping (Linear → warden), mirroring Superset's:** `identifier`→slug, `priority` (0–4)↔label (none/urgent/high/medium/low), `state`→status (the per-team workflow state; keep `state.type` ∈ backlog/unstarted/started/completed/canceled for grouping), `assignee` snapshot (id/name/email/avatar). Status sets are **per team** — fetch a team's `states()` when rendering/mapping its issues.

**Bindings (P3+):** the repo→Linear binding lives in committable **`.warden/config.json`** (see *Config & storage tiers*), not the DB. Optional `group_id → saved_view_id?` (P4) stays in `settings`.

## Config & storage tiers

Three tiers, with a hard rule: **secrets never leave the keychain, and never enter a committable file.** Modeled on jean's split (jean keeps non-secret scripts in a committable `jean.json` at `projects/types.rs:36–71`, but Linear binding + key in a private app DB) — we go one step further and make the *non-secret binding* committable too, since it's a property of the repo.

1. **`.warden/config.json` (in repo, committable):** repo-intrinsic, non-secret, shareable config — the Linear team/project binding, plus a natural home for context folders, setup scripts, and workflow/agent defaults later. Keyed by repo path. Read it if present; absent/malformed → treat as unbound, never crash. (Optional future, VS Code-style: a gitignored `.warden/config.local.json` for personal overrides.)
2. **App DB (SQLite, private):** the `linear_issues` cache + last-sync cursor + connection flag. Machine-local, never shared.
3. **OS keychain:** the API key, only.

Proposed `.warden/config.json` shape (v1 keeps it minimal):

```jsonc
{
  "linear": {
    "teamId": "…",        // Linear team UUID — drives the repo's Issues panel + status set
    "projectId": "…"      // optional narrowing filter
  }
}
```

---

## Code architecture: Providers vs Integrations

Two **orthogonal** axes already live in the codebase; the integration work must keep them separate.

- **Managed-binary axis (`cli::Tool`, [`cli/mod.rs:24`](../src-tauri/src/cli/mod.rs)):** which features ship/manage a CLI binary (install / version / resolve). Today `Claude`, `Codex`, `Gh`; Linear has none. An *implementation* substrate shared by anything that needs a binary.
- **Semantic-role axis:**
  - **Provider** — executes an agent's turn; the AI-model source a session runs on. Maps 1:1 onto `domain::Backend` ([`providers/mod.rs:18`](../src-tauri/src/providers/mod.rs)). Chosen per session, mutually exclusive. Today: Claude, Codex.
  - **Integration** — supplies external info or performs external actions (PRs, issues, tasks). Connected once, additive, orthogonal to which provider runs. Today: GitHub; next: Linear.

The axes **cross-cut**: GitHub is an Integration that *brokers a managed CLI* (`gh`); Linear is an Integration with *no* CLI. So "is it an integration?" must never collapse into "does it have a CLI?" — the `gh` entry stays in `cli::Tool`; only GitHub's *service* code is namespaced under `integrations/`.

> Test: *"Does it run the agent's turn?"* → **Provider**. *"Does it bring in outside data / push outside actions?"* → **Integration**.

**Layout decisions:**
- Backend: keep `cli/` (substrate) + `providers/` (Claude, Codex); add `integrations/{github,linear}/`. Shared connection/credential helpers in `integrations/mod.rs`; **no shared trait yet** — github (CLI + token) and linear (API key + GraphQL) are too different, and two cases is too little signal (abstract on the *third* integration).
- Frontend: a **feature-folder per integration** — `src/integrations/{github,linear}/` with slice + components + ipc + types co-located; each wired into the central `app-store`.
- **Leave room for a third bucket:** MCP/capabilities (tools the agent *calls*) is neither Provider nor Integration — a future sibling `capabilities/` (or `mcp/`), not folded into `integrations/`.

**GitHub move (do now):** relocate `src-tauri/src/github/ → src-tauri/src/integrations/github/` and the scattered frontend github code → `src/integrations/github/`. Mechanical, no behavior change; fix references in [`cli/install.rs`](../src-tauri/src/cli/install.rs), [`cli/archive.rs`](../src-tauri/src/cli/archive.rs) (`github_get` / `resolve_token`), and [`lib.rs`](../src-tauri/src/lib.rs) (command registration + `github::poll::spawn`). The `gh` tool stays in `cli::Tool`; GitHub's `download` submodule remains the `gh` distributor at its new path.

## Backend modules (`src-tauri/src/integrations/`)

New `src-tauri/src/integrations/linear/`, shaped like the (now-relocated) `integrations/github/`:

- `mod.rs` — module wiring + connection status.
- `key.rs` — keychain get/set/clear (the analogue of `github/token.rs`).
- `client.rs` — `reqwest` GraphQL client + query/mutation strings + `serde` response types.
- `sync.rs` — issue fetch + cache upsert + cursor advance.
- `poll.rs` — `tauri::async_runtime::spawn` interval loop; emit a `linear-issues-changed` event on change (copy `github/poll.rs` structure).
- `commands.rs` — Tauri commands: `linear_connect(key)`, `linear_disconnect`, `linear_status`, `linear_list_issues(filter)`, `linear_refresh`. (P2 adds `linear_update_issue`, `linear_create_issue`.)

Register commands as `integrations::linear::commands::*` in the `collect_commands!` macro in [`lib.rs`](../src-tauri/src/lib.rs) (the github commands move alongside, to `integrations::github::commands::*`) so `tauri-specta` regenerates TS bindings; spawn the poller next to the relocated `integrations::github::poll::spawn` at [`lib.rs:211`](../src-tauri/src/lib.rs). Add the `keyring` crate to `Cargo.toml`.

## Frontend

Feature-folder `src/integrations/linear/` (co-located; mirrors a relocated `src/integrations/github/`):

- **Store slice** `src/integrations/linear/store.ts`, mirroring [`workflows.ts`](../src/store/slices/workflows.ts): `linearConnected`, `issuesById`, `issueFilter`, `syncing`, actions `connectLinear/disconnectLinear/loadIssues/setFilter`, and an event subscription that reloads on `linear-issues-changed`. Still assembled into the central store — add to `AppState` ([`store/types.ts`](../src/store/types.ts)) + `app-store.ts`. (The slice registration is the one tether to the center; everything else stays in the feature folder.)
- **IPC wrappers** `src/integrations/linear/ipc.ts` over the new commands (specta types auto-generated).
- **Types** `src/integrations/linear/types.ts` — issue + binding shapes.
- **UI** `src/integrations/linear/components/` — the reusable, filter-parameterized issue list (shared by the global inbox and the repo Issues tab). Replace [`tasks-view.tsx`](../src/components/tasks-view.tsx) to render it; the seam is wired (the `tasks` kind renders `<TasksView/>` at [`content-registry.tsx:72`](../src/lib/viewport/content-registry.tsx)). v1: a connect-key state → filterable list (group by status; filter by team/assignee/label) + manual refresh + "synced Ns ago". No drag-to-session yet (P3).

---

## Folder view as a repo "home" (P3)

[`folder-view.tsx`](../src/components/folder-view.tsx) today is a single session table for one repo (header + filter bar + `DataTable` of sessions). Extend it into a sectioned repo home with a segmented control — **Sessions | Issues | …** (PRs/Workflows later):

- Keep today's table as the **Sessions** tab. Add an **Issues** tab showing the repo's bound Linear issues (filtered by `.warden/config.json`'s `teamId`/`projectId`).
- Build the issue list as **one reusable component parameterized by a filter**, shared by *both* the global Tasks inbox and this Issues tab (global = the user's default filter; repo tab = the repo binding). No duplication.
- This is the natural home for the **issue → session/workflow handoff**: a "Start session from issue" action sits next to the sessions it spawns (pre-fill branch `feature/<identifier>`, seed the prompt with the issue title + description, write status back on commit/PR).
- This is an internal change to `FolderView` (add a tab control + sub-views); it does *not* touch the `folder:<projectId>` content-registry routing.

## Phasing

- **P1 — v1 (shipped): connection + read-only inbox.** Keychain key entry, poll/cache sync loop, global filterable Tasks list, manual refresh. Read-only. Validates the sync engine end-to-end.
- **P1.5 — v1.5 (shipped): in-app task view + send to agent + bindings.** Issue peek panel (markdown description + live-fetched comments — comments stay out of the poll query to keep its complexity flat, fetched per-issue on panel open instead), "Send to Agent" (repo/model/mode/isolate → chat session seeded with the full issue), `.warden/config.json` repo→team/project binding, FolderView **Sessions | Tasks** tabs on the shared issue-list component. Note: the cache is assigned-to-me only, so a folder's Tasks tab shows *your* issues in the bound team, not the team's whole board.
- **P2 — writeback.** Outbound mutations (status change, reassign, create issue) with optimistic updates + `updatedAt`-guarded last-write-wins. (Includes moving an issue to "started" when sent to an agent.)
- **P3 — remaining agent handoff.** Branch pre-fill (`feature/<identifier>`), send to *workflow* (seed a node-graph run from an issue), status writeback on commit/PR.
- **P4 — group saved views.** Optional per-group default Linear filter.

---

## Open questions / risks

- **Archived/deleted issues in v1.** An incremental `updatedAt` poll may not return newly archived issues, so they can linger in the cache until a periodic full reconcile. Acceptable for read-only v1; flag in UI or add a daily full refresh.
- **Status mapping across teams.** A project can contain issues from multiple teams, each with its own workflow states. Binding primarily to a **team** keeps this clean; revisit if project-level binding is requested.
- **Conflict resolution** is deferred to P2 (read-only v1 has no outbound writes to conflict).
- **Keychain availability** on Linux (Secret Service) can be absent on headless/minimal setups — fall back to an explicit warning, not silent plaintext.
- **Rate limits / pagination** — confirm Linear's current complexity budget; cap pages per poll and back off on 429.

---

## Verification (v1, end-to-end)

1. **Connect:** paste a personal API key → `linear_connect` stores it in the keychain; `linear_status` reports connected. Confirm the key is **not** in the SQLite `settings` table or any log.
2. **Initial load:** inbox populates with issues assigned to the user; verify field mapping (status, priority, assignee, labels, identifier link to `url`).
3. **Incremental sync:** edit an issue's title/status in Linear → within one poll interval (≤60s) the inbox reflects it; confirm the `updatedAt` cursor advanced and only changed rows were re-fetched.
4. **Filters:** team / status / assignee / label filters narrow the list correctly against the cache.
5. **Offline:** kill network → cached inbox still renders; refresh shows a clear error, no crash.
6. **Disconnect:** `linear_disconnect` clears the keychain entry and the cache; Tasks returns to the connect state.
