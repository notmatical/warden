# warden — Product & Architecture Overview

> A browser for your AI agent sessions.

warden is a Tauri 2 + React desktop app for running and orchestrating many AI
agent sessions across providers from one unified interface. This document is the
reference for future coding sessions: it captures the vision, the design
decisions (with their reasoning), the module layout, and the contracts between
backend and frontend. Read it before extending the codebase so you don't
re-derive the design.

---

## 1. Vision & metaphor

warden treats AI agent sessions the way a web browser treats web pages. You open
many of them, switch between them, route new ones from a single entry point, and
keep a history. The browser metaphor is the product's mental model and drives the
UI vocabulary.

| Browser concept        | warden concept                                                        |
| ---------------------- | --------------------------------------------------------------------- |
| Tab                    | An agent session                                                      |
| Window / tab group     | A workspace (a repo and its worktrees)                               |
| Omnibox                | Start / route a session                                              |
| Bookmarks              | Saved prompts and recipes                                            |
| History                | Past sessions                                                        |
| Profiles               | Provider accounts                                                    |
| Extensions             | MCP servers                                                          |
| DevTools               | Raw event stream / diff / cost inspector                            |
| Hyperlink              | A handoff between sessions that carries context                      |

A session is a tab. A workspace is the window that groups the tabs working on one
repo. The omnibox starts or routes work. A "hyperlink" is the key non-obvious
mapping: when one session hands off to another (e.g. plan -> code), context
travels with it, exactly like following a link.

---

## 2. The wedge — what makes warden different

warden's differentiation is **not** "supports N providers." Multi-provider
support is table stakes and arrives later. The wedge is two things:

1. **A clean, unified multi-agent UX.** One coherent surface for managing many
   concurrent agents, their transcripts, and their diffs — instead of N terminal
   windows with N different conventions.

2. **Deterministic, repeatable orchestration recipes.** Fixed, replayable
   workflows (e.g. plan -> code) layered on shared primitives. This is contrasted
   with **emergent, agent-driven orchestration** (agents calling each other via
   MCP), which is powerful but non-deterministic.

Both modes are valid and will eventually **coexist on one substrate**:
deterministic recipes for workflows you want to trust and repeat, emergent
orchestration for open-ended delegation. warden starts with the deterministic
side because that is where the reliability and the demonstrable value live.

---

## 3. Core architecture decisions

Each decision below records the *why*, because the reasoning is what keeps future
changes aligned.

### 3.1 Wrap the agent CLIs via their structured stream modes

warden drives agents through their CLIs in structured streaming mode — e.g.
`claude --print --output-format stream-json …` — **not** via a language SDK and
**not** via direct provider HTTP APIs.

**Why:** the inner agent loop (tool use, permissions, MCP, git awareness) is
where the vendor CLIs improve fastest. warden's value is the *orchestration and
UX layer*, not a better inner loop. Wrapping the CLI lets us inherit every inner-
loop improvement for free and keep our surface area small.

### 3.2 No forced uniform adapter trait

Providers genuinely diverge: some are CLI-over-stdio, others are local HTTP
servers. We do **not** force every provider behind one uniform `Adapter` trait
that pretends they are the same.

**Why:** a lowest-common-denominator abstraction would either leak or lie. We
share only what is actually common: the **lifecycle** (spawn / cancel / status /
usage) and a **normalized `AgentEvent` contract**. Everything provider-specific
lives in that provider's own spawn module.

### 3.3 Worktree-per-session isolation

Each session runs in its own git worktree branched off a base commit. Many agents
can therefore work the same repo concurrently without stepping on each other. The
diff tab for a session is simply *worktree vs base*.

### 3.4 The event log is the spine

Every agent action is an **append-only event** carrying `sessionId` and
`workspaceId`, persisted in order. The transcript you see today and the
cross-agent **shared thread** we want later are the *same log, queried two ways*
(by session, or by workspace across sessions).

**This is the one forward-compatibility decision that matters.** Get the event
log right and the interop surface is a query, not a rewrite.

### 3.5 Interop via a shared, rendered thread (future)

When agents collaborate, they will do so through a **shared, rendered thread** —
like contributors commenting on a pull request — **not** raw model-to-model
piping. A rendered thread is legible, correctable, and replayable; a human can
read it, intervene, and re-run it. Raw piping is none of those. The agent
conversation is a first-class UI surface, not a hidden channel.

### 3.6 One process per turn

A turn is one CLI process. The first turn spawns with `--session-id`; later turns
use `--resume <id>`.

**Why:** one-shot processes are robust and simple — no long-lived stdin to keep
healthy, no partial-state recovery. The CLI owns durable session state; we just
re-attach to it.

### 3.7 Permission posture follows isolation

Because sessions are worktree-isolated, the blast radius of an agent is contained
to its worktree. So:

- **Coders** default to `bypassPermissions` for prompt-free autonomy.
- **Planners** use Claude's `plan` mode (read-only).

Isolation is what makes prompt-free autonomy safe to default to.

---

## 4. Tech stack

| Layer            | Choice                                                      |
| ---------------- | ----------------------------------------------------------- |
| Shell            | Tauri 2 (Rust)                                              |
| Frontend         | React 19 + Vite + Tailwind v4 + shadcn (style `radix-rhea`) |
| Icons            | lucide                                                      |
| Persistence      | SQLite via `rusqlite` (the event log)                       |
| Process / stream | `tokio` (spawn + stream the agent CLIs)                     |
| Isolation        | git worktrees                                               |
| Package manager  | bun                                                         |

**Data location.** The SQLite database and the per-session worktrees live in the
OS app-data directory, not in the user's repo.

---

## 5. Module map

### 5.1 Backend (`src-tauri/src/`)

| Module       | Responsibility                                                            |
| ------------ | ------------------------------------------------------------------------- |
| `error`      | Error types and conversions.                                              |
| `util`       | Small shared helpers.                                                     |
| `domain`     | Core types: `event`, `session`, `workspace`.                              |
| `store`      | SQLite store + schema migrations (the event log lives here).              |
| `git`        | Worktree creation and diff computation.                                   |
| `events`     | Emits the frontend event channels.                                        |
| `agent`      | Stream parser, the `claude` adapter, and the session manager.             |
| `provision`  | Sets up worktrees / working dirs for sessions.                            |
| `recipes`    | Deterministic orchestration recipes (e.g. plan -> code).                  |
| `commands`   | The `#[tauri::command]` surface invoked from the frontend.                |
| `state`      | App-wide shared state (handles, store, manager).                          |
| `lib`        | Crate root; wires modules and registers commands.                         |

### 5.2 Frontend (`src/`)

| Area               | Responsibility                                                          |
| ------------------ | ----------------------------------------------------------------------- |
| `types`            | TypeScript mirrors of the serde shapes (see §6).                        |
| `lib/ipc`          | Typed wrappers over Tauri `invoke()`.                                   |
| `lib/events`       | Subscriptions to the backend event channels.                           |
| `store` (zustand)  | Client state: workspaces, sessions, transcripts, diffs.                 |
| `components`       | The browser shell (below).                                              |

**Browser shell components:** `topbar`, `omnibox`, `session-tabs`,
`session-view`, `transcript`, `diff-view`, `composer`.

---

## 6. The contract: commands & events

The Tauri boundary is the load-bearing contract. Rust fn params are `snake_case`;
the frontend `invoke()` sends **camelCase** keys (Tauri converts).

### 6.1 Commands

| Command                | Params (camelCase from frontend)                                              | Returns             |
| ---------------------- | ----------------------------------------------------------------------------- | ------------------- |
| `list_workspaces`      | —                                                                             | `Workspace[]`       |
| `open_workspace`       | `path`                                                                        | `Workspace`         |
| `list_sessions`        | `workspaceId`                                                                 | `Session[]`         |
| `get_events`           | `sessionId`                                                                   | `EventRecord[]`     |
| `get_diff`             | `sessionId`                                                                   | `DiffResult`        |
| `create_session`       | `workspaceId`, `title`, `model`, `permissionMode`, `role?`                    | `Session`           |
| `send_message`         | `sessionId`, `text`                                                           | `()` (fire-and-forget; streams via events) |
| `cancel_session`       | `sessionId`                                                                   | `()`                |
| `run_plan_to_code`     | `workspaceId`, `task`, `plannerModel`, `coderModel`                           | `PlanToCodeResult`  |

`open_workspace` records whether the path is a git repo (git repos get isolated
worktrees per session; non-git folders run in place) and upserts it.
`send_message` returns immediately; output arrives over the event channels.

### 6.2 Event channels (backend -> frontend)

| Channel           | Payload                                       | Notes                                   |
| ----------------- | --------------------------------------------- | --------------------------------------- |
| `agent-event`     | `EventRecord`                                 | A newly persisted, ordered event.       |
| `agent-delta`     | `{ sessionId, text }`                         | Transient streaming text; not persisted. |
| `session-updated` | `Session`                                     | Status / turns / cost changed.          |

### 6.3 JSON shapes (authoritative)

These are camelCase on the wire.

```ts
Workspace = { id, name, path, isGit: boolean, createdAt }

Session = {
  id, workspaceId, title,
  backend: "claude",
  model,
  permissionMode: "acceptEdits" | "bypassPermissions" | "plan" | "default",
  status: "idle" | "running" | "error",
  role: "chat" | "planner" | "coder",
  agentSessionId, workingDir,
  branch: string | null, baseSha: string | null,
  isIsolated: boolean,
  turns: number, costUsd: number,
  parentId: string | null,
  createdAt, updatedAt
}

FileChange = { path, additions, deletions, binary }

DiffResult = { baseSha: string | null, unified: string, files: FileChange[], truncated: boolean }

PlanToCodeResult = { planner: Session, coder: Session }
```

### 6.4 `AgentEvent` — the normalized event contract

`AgentEvent` is an **internally-tagged** serde enum. The tag field is `type`,
variant names are `snake_case`, and **the fields inside each variant are
`snake_case` too** (not camelCase — this is the one place the camelCase rule does
*not* apply).

| `type`           | Fields                                                              |
| ---------------- | ------------------------------------------------------------------- |
| `session_init`   | `model: string \| null`, `tools: string[]`                          |
| `user_message`   | `text`                                                              |
| `assistant_text` | `text`                                                              |
| `text_delta`     | `text` — transient only; **never persisted**                        |
| `thinking`       | `text`                                                              |
| `tool_use`       | `id`, `name`, `input: any`                                          |
| `tool_result`    | `tool_use_id`, `content`, `is_error: bool`                          |
| `result`         | `is_error: bool`, `cost_usd`, `duration_ms`, `num_turns` (nullable) |
| `notice`         | `text`                                                              |
| `error`          | `message`                                                           |

**`EventRecord`** is an `AgentEvent` flattened together with a camelCase wrapper:
`{ id, sessionId, seq: number, ts }`. So a persisted assistant message on the
wire is:

```json
{ "id": "...", "sessionId": "...", "seq": 12, "ts": "...", "type": "assistant_text", "text": "..." }
```

Note the deliberate split: the wrapper (`id`, `sessionId`, `seq`, `ts`) is
camelCase; the flattened `AgentEvent` payload (`type`, `text`, `tool_use_id`, …)
is snake_case.

---

## 7. The `plan -> code` recipe

This is warden's **first deterministic recipe** and the template for the rest.

**Flow:**

1. A **Sonnet** planner session runs in **plan mode** (read-only) and produces a
   plan.
2. An **Opus 4.8** coder session runs in **bypassPermissions** and implements it.
3. Both sessions **share one worktree** — the coder works on exactly what the
   planner inspected.
4. The plan text is **injected as the coder's first message**.
5. `notice` events mark the handoff so it is visible and replayable in the
   transcript.

`run_plan_to_code` returns both sessions (`PlanToCodeResult { planner, coder }`).
The handoff is the "hyperlink" from §1: context flows from one tab to the next.

**Future recipes follow the same template** (one or more roles, a shared or fresh
worktree, injected context, `notice`-marked handoffs):

- code-review
- write-tests
- fix-review-comments

---

## 8. Roadmap

### v0 — foundation (building now)

One Claude tab, end-to-end:

- spawn -> stream -> worktree -> diff
- detach / reattach to a running session
- the `plan -> code` recipe

### Next

- **Multi-provider** — codex / cursor as separate spawn modules (no forced
  uniform trait; share lifecycle + `AgentEvent`).
- **Shared-thread interop surface** — render the cross-session thread from the
  event log (the §3.4 / §3.5 payoff).
- **Usage / cost analytics** across providers.
- **GitHub integration** via the `gh` CLI.
- **Saved recipes / bookmarks.**
- **MCP substrate** for emergent, agent-driven orchestration — the second mode
  that coexists with deterministic recipes.

---

## 9. Conventions

- **Conventional Commits** (`feat`, `fix`, `refactor`, `perf`, `docs`, `test`,
  `build`, `ci`, `chore`, `style`); `!` for breaking changes.
- **Small, focused commits.** No giant sweeping commits; group related changes.
- **No `Co-Authored-By: Claude`** trailers anywhere.
- **Modular code** — keep modules narrow and aligned with the §5 map.
- **No `// TODO` stubs** — land working slices, not placeholders.
- **Comment only non-obvious decisions** (1–2 lines); prefer self-explanatory
  code over explanatory comments.
