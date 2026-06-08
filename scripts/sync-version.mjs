// Propagate package.json's version into the Tauri config + Cargo.toml (+ Cargo.lock)
// so a single `changeset version` keeps every source in lockstep: the displayed
// version (__APP_VERSION__, read from package.json), the bundled app version, and
// the auto-updater's "current version" (both read from tauri.conf.json / Cargo.toml).
// We rewrite Cargo.lock by hand rather than shelling out to `cargo`, since the CI
// `version` job has no Rust toolchain installed.
import { readFileSync, writeFileSync } from "node:fs"

const version = JSON.parse(readFileSync("package.json", "utf8")).version

// tauri.conf.json — pretty-printed, keep a trailing newline.
const confPath = "src-tauri/tauri.conf.json"
const conf = JSON.parse(readFileSync(confPath, "utf8"))
conf.version = version
writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`)

// Cargo.toml — the first top-level `version = "..."` is the [package] version
// (dependency versions never start a line). Replace just that one.
const cargoPath = "src-tauri/Cargo.toml"
const cargo = readFileSync(cargoPath, "utf8").replace(
  /^version = "[^"]*"/m,
  `version = "${version}"`
)
writeFileSync(cargoPath, cargo)

// Cargo.lock — bump the version on the crate's own [[package]] entry (matched by
// `name = "warden"`) so the lockfile stays in sync and `--locked` builds pass.
const lockPath = "src-tauri/Cargo.lock"
const lock = readFileSync(lockPath, "utf8").replace(
  /(name = "warden"\r?\nversion = ")[^"]*(")/,
  `$1${version}$2`
)
writeFileSync(lockPath, lock)

console.log(
  `Synced version ${version} -> tauri.conf.json, Cargo.toml, Cargo.lock`
)
