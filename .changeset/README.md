# Changesets

This folder holds [changesets](https://github.com/changesets/changesets): one
markdown file per user-facing change, declaring a `patch`/`minor`/`major` bump.

Add one with `bun run changeset` after a change that affects the app. At release
time, `bun run version-packages` consumes them to bump `package.json`, write
`CHANGELOG.md`, and sync the new version into `tauri.conf.json` + `Cargo.toml`
(via `scripts/sync-version.mjs`) so every source agrees. Commit that, then tag
`vX.Y.Z` to trigger the release build.

Skip a changeset only for changes that don't affect the shipped app (CI, docs,
internal tooling).
