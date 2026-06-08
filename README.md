# warden

**A browser for your AI agent sessions.**

warden is a Tauri 2 + React desktop app for running and orchestrating many AI
agent sessions across providers in one unified interface. Each session is a tab,
each project is a workspace, and an omnibox routes new work. Sessions run in
isolated git worktrees, produce a live transcript and diff view, and a visual
workflow editor lets you chain agents together in deterministic, repeatable
pipelines.

---

## Core features

### Sessions as tabs
Every agent session is a browser tab. Open many of them across one or more
repos, switch between them, drag them into split panes. The transcript, diff,
and composer are always one click away.

### Worktree isolation
Each session spins up its own git worktree so concurrent agents never step on
each other. The diff view shows exactly what that session changed relative to
its base commit. Merge back with one click — warden opens a PR or integrates
directly.

### Visual workflow editor
Draw multi-agent pipelines on a canvas. Nodes carry an intent (plan, code,
review, revise, custom), a model, and a prompt. Gate nodes pause execution for
human sign-off. Outputs from upstream nodes are automatically injected as
context downstream. The whole graph is replayable.

### Multi-provider
Claude and Codex ship out of the box. warden manages the CLI binaries for you
(download, update, auth), or falls back to whatever is on your PATH. Providers
are first-class: each session shows which provider and model is running.

### Native terminal
Any session can be a PTY terminal running a provider's TUI or your own shell —
same tab strip, same sidebar.

### GitHub integration
Review PRs directly in warden: `gh pr checkout` spins up a new session in a
worktree on the PR branch. Inline status for checks, merge controls, and
auto-generated PR descriptions from the diff.

### @-mention autocomplete
Type `@` in the composer to autocomplete repo files (gitignore-aware), slash
commands, and GitHub issue/PR references.

### Context sources
Attach persistent context to a session — text snippets, file references, or
outputs from other sessions. Context is assembled into the system prompt and
survives resumption.

---

## Prerequisites

- **Rust** (stable toolchain, for Tauri 2)
- **bun**
- **git**
- The **`claude` CLI**, installed and logged in

---

## Quickstart

```bash
bun install
bun run dev
```

The first `bun run dev` compiles the Rust crate (Tauri + rusqlite), which takes
a few minutes. Subsequent runs are incremental and fast.

### Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | **Full stack** — Rust backend + Vite dev server with hot reload. |
| `bun run dev:web` | Frontend only at `http://localhost:1420`. Fast for UI work; `invoke()` calls fail without the backend. |
| `bun run build` | Full release bundle via `tauri build`. |
| `bun run build:web` | Type-check + build web assets only (`dist/`). |
| `bun run typecheck` | TypeScript type-check (no emit). |
| `bun run lint` | ESLint. |
| `bun run format` | Prettier. |

---

## Stack

| Layer | Choice |
| --- | --- |
| Shell | Tauri 2 (Rust) |
| Frontend | React 19 + Vite + Tailwind v4 + shadcn (`radix-rhea`) |
| Icons | lucide |
| Workflow editor | React Flow (`@xyflow/react`) |
| Terminal | xterm.js + portable-pty (Rust) |
| Persistence | SQLite via `rusqlite` |
| Async runtime | tokio |
| Isolation | git worktrees |
| Package manager | bun |

---

## Docs

| Document | What it covers |
| --- | --- |
| [`docs/OVERVIEW.md`](docs/OVERVIEW.md) | Full product and architecture design — read this before extending the codebase. |
| [`docs/BUNDLE-OPTIMIZATION.md`](docs/BUNDLE-OPTIMIZATION.md) | Frontend bundle analysis and optimization techniques. |
| [`docs/BUILD-PERFORMANCE.md`](docs/BUILD-PERFORMANCE.md) | Dev and CI build speed — Rust incremental compilation, caching, parallel jobs. |
| [`docs/TESTING.md`](docs/TESTING.md) | Testing strategy, how to run tests, and CI integration. |
