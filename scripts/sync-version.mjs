// Propagate package.json's version into the Tauri config + Cargo.toml so a single
// `changeset version` keeps every source in lockstep: the displayed version
// (__APP_VERSION__, read from package.json), the bundled app version, and the
// auto-updater's "current version" (both read from tauri.conf.json / Cargo.toml).
import { readFileSync, writeFileSync } from "node:fs";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;

// tauri.conf.json — pretty-printed, keep a trailing newline.
const confPath = "src-tauri/tauri.conf.json";
const conf = JSON.parse(readFileSync(confPath, "utf8"));
conf.version = version;
writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`);

// Cargo.toml — the first top-level `version = "..."` is the [package] version
// (dependency versions never start a line). Replace just that one.
const cargoPath = "src-tauri/Cargo.toml";
const cargo = readFileSync(cargoPath, "utf8").replace(
	/^version = "[^"]*"/m,
	`version = "${version}"`,
);
writeFileSync(cargoPath, cargo);

console.log(`Synced version ${version} -> tauri.conf.json, Cargo.toml`);
