# Changesets

This folder holds [changesets](https://github.com/changesets/changesets): one
markdown file per user-facing change, declaring a `patch`/`minor`/`major` bump.

Add one with `bun run changeset` after a change that affects the app. At release
time, `bun run version-packages` consumes them to bump `package.json` and write
`CHANGELOG.md`; the release workflow then syncs `tauri.conf.json` / `Cargo.toml`
from the tag and builds the installers.

Skip a changeset only for changes that don't affect the shipped app (CI, docs,
internal tooling).
