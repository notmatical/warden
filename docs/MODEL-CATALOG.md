# Dynamic model catalog

## Problem

Model availability changes faster than warden releases. Today the picker list,
fast-tier variants, and per-role defaults are frozen into each build via
`apps/desktop-frontend/src/config/models.json` — adding a new Claude model (or
retiring an old id) requires editing the file, cutting a release, and every
user updating. OpenCode already escapes this (its models are listed live from
the CLI); Claude and Codex should too.

## Design

Promote the existing `models.json` to a **versioned catalog fetched at
runtime**, with the bundled copy as the offline fallback. One file remains the
single source of truth for both the app and the Rust backend:

```
remote (raw.githubusercontent.com, main branch)
  → localStorage cache (last good fetch)
    → bundled models.json (compiled into the build)
```

Publishing a model becomes: edit `models.json`, merge to `main`. Every
installed app picks it up within the refresh window — no release, no tag.

### Hosting

The catalog is served from the repo itself:

```
https://raw.githubusercontent.com/<org>/warden/main/apps/desktop-frontend/src/config/models.json
```

- Zero duplication: the remote catalog and the bundled fallback are literally
  the same file, so they can never drift.
- No extra infrastructure; GitHub's raw CDN caches for ~5 minutes.
- If catalog churn on `main` ever becomes a problem, the URL can later point
  at a dedicated `warden-catalog` repo without any schema change.

### Schema (v1)

The current file plus a version gate and per-model flags; `fastVariants`
folds into the model entries:

```jsonc
{
  "version": 1,
  "updatedAt": "2026-07-08",
  "models": [
    {
      "id": "claude-opus-4-8[1m]",
      "label": "Opus 4.8 (1M)",
      "provider": "Anthropic",
      "fastId": "claude-opus-4-8[1m]-fast", // replaces top-level fastVariants
      "recommended": true,                  // optional: picker highlight
      "deprecated": false,                  // optional: sorted last, muted
      "hidden": false                       // optional: usable but unlisted
    }
  ],
  "defaults": { "chat": "...", "planner": "...", "coder": "...",
                "codexChat": "...", "opencodeChat": "..." },
  "fastWorkflows": { "claude": "haiku", "codex": "...", "opencode": "..." }
}
```

Rules:

- Clients parse only `version === 1`; anything else falls back to
  cache/bundled. Additive fields are non-breaking (both serde and the TS
  validator ignore unknown keys); a breaking change bumps the version, and
  older builds keep working on their bundled list.
- Per-entry validation: `id`, `label`, `provider` must be non-empty strings;
  malformed entries are dropped individually, never the whole catalog.
- `hidden` retires a model from the picker while `formatModelName` and
  resumed sessions keep working. `deprecated` keeps it listed but muted and
  sorted last (grace period before hiding).
- Backend routing stays derived from id shape (`backendForModel` /
  `Backend::for_model`), so catalog-only additions need no code change as
  long as new ids follow the existing prefixes. A model that needs a *new*
  backend still needs code — the catalog can't invent providers.

### Fetch + cache (frontend)

New `src/lib/model-catalog.ts`:

- Fetch with an 8s `AbortController` timeout, `cache: "no-store"`; manual
  refreshes append `?t=<now>` to bust GitHub's CDN cache.
- Validate → write to `localStorage["warden:model-catalog:v1"]` as
  `{ catalog, fetchedAt }`.
- Load order at startup: hydrate synchronously from cache (else bundled),
  then revalidate in the background. Refresh hourly while running.
- Failure at any step degrades one layer; the app never has an empty picker.

### Consumption (the real refactor)

`src/lib/models.ts` currently exports constants (`MODELS`,
`DEFAULT_CHAT_MODEL`, …) that modules capture at import time. With a mutable
catalog those become reads of a module-level snapshot:

- `getModels()` / `useModels()` (subscription hook) replace the `MODELS`
  constant for the pickers.
- `defaultModel(role)` / `defaultModelFor(backend)` replace the `DEFAULT_*`
  constants. Call sites resolve at use time (session creation, workflow
  config), so a defaults change in the catalog applies to the next session,
  never to existing ones.
- `supportsFast`/`withFast` read `fastId` from the live snapshot.
- The snapshot starts as the bundled catalog, so all reads are valid before
  the first fetch resolves.

### Rust backend

Unchanged in v1. `warden-core` keeps its compiled-in copy (only
`fastWorkflows` — the cheap-model choice for session naming / PR drafting).
Those ids change rarely, and a stale one fails soft (the CLI rejects it and
the feature degrades, sessions are unaffected). If that ever bites, phase 2
is a backend fetch with the same fallback chain cached in the app data dir.

### Trust & failure notes

- The catalog is data from our own repo over HTTPS, holding the same ids we
  ship in builds today — same trust boundary as the code itself. Strict
  validation bounds the blast radius of a bad merge to "picker shows a wrong
  label/id", which the next merge fixes globally.
- Session records store the model id, not a catalog reference — resumed
  sessions on retired ids keep rendering via `formatModelName`'s shape
  parser, exactly as today.

## Out of scope (v1)

- Fetching the catalog in Rust (phase 2 if fast-workflow staleness matters).
- Per-model capability flags (`supportsImages`, `supportsThinking`) — the
  schema allows adding them later without a version bump.
- A settings UI for catalog URL overrides (enterprise/self-host) — trivial to
  add later since the URL is a single constant.
