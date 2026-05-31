# warden

**A browser for your AI agent sessions.**

warden is a Tauri 2 + React desktop app for running and orchestrating many AI
agent sessions across providers in one unified interface. Each session is a tab,
each repo is a window, and an omnibox starts new work. Sessions run in isolated
git worktrees with a live transcript and a diff view, and deterministic recipes
(like `plan -> code`) hand work off between agents.

See [`docs/OVERVIEW.md`](docs/OVERVIEW.md) for the full product and architecture
design.

## Prerequisites

- **Rust** (stable toolchain, for Tauri 2)
- **bun**
- **git**
- The **`claude` CLI**, installed and logged in

## Quickstart

```bash
bun install
bun run dev
```

### Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | **Full stack** — compiles the Rust backend and launches the desktop app with the Vite dev server (hot reload). This is how you actually run warden. |
| `bun run dev:web` | Frontend only at `http://localhost:1420`. Fast for UI work, but `invoke()` calls fail — there's no Tauri backend. |
| `bun run build` | Full release bundle (installer) via `tauri build`. |
| `bun run build:web` | Type-check + build the web assets only (`dist/`). |
| `bun run typecheck` / `lint` / `format` | TypeScript, ESLint, Prettier. |

> The first `bun run dev` compiles the Rust crate (Tauri + rusqlite), which takes
> a few minutes. Subsequent runs are incremental and fast.

## Stack

Tauri 2 (Rust) · React 19 · Vite · Tailwind v4 · shadcn (`radix-rhea`, lucide) ·
SQLite (`rusqlite`) · tokio · git worktrees.
