# Changesets

This folder holds [changesets](https://github.com/changesets/changesets): one
markdown file per user-facing change, declaring a `patch`/`minor`/`major` bump.

Add one with `bun run changeset` after a change that affects the app. At release
time, `bun run version-packages` consumes them to bump `package.json`, write
`CHANGELOG.md`, and sync the new version into `tauri.conf.json` + `Cargo.toml`
(via `scripts/sync-version.mjs`) so every source agrees. Commit that, then tag
`vX.Y.Z` to trigger the release build.

## Pre-1.0 bump policy

While the app is pre-1.0 (`0.x.y`), the version digits shift down one slot — so
pick the changeset type by what it would be *after* 1.0, then bump one weaker:

- `patch` — fixes **and** features (this is the common case for now).
- `minor` — breaking changes only.
- `major` — reserved for graduating to `1.0.0`.

Changesets applies the type you choose literally (it has no pre-1.0 mode), so a
feature must be authored as `patch` to stay on the `0.x` line.

Skip a changeset only for changes that don't affect the shipped app (CI, docs,
internal tooling).
