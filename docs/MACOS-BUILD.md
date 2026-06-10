# macOS builds

Warden ships Windows today. This documents the macOS build path, starting from
an unsigned test build and the steps to reach a signed, notarized release.

## Hard constraint

macOS `.app`/`.dmg` bundles **must be built on a macOS runner** — they can't be
cross-compiled from Windows or Linux. macOS builds are therefore CI-only (or
require a Mac).

## Phase 1 — unsigned test build (current)

[`build-macos.yml`](../.github/workflows/build-macos.yml) is a manual,
`workflow_dispatch`-only job. Trigger it from the Actions tab; it produces an
**unsigned universal `.dmg`** (Intel + Apple Silicon) as a downloadable
workflow artifact.

An unsigned build runs on the machine that built it, but on other Macs
Gatekeeper blocks it. To test the artifact on a Mac: **right-click the app →
Open** (or `xattr -dr com.apple.quarantine Warden.app`). This is fine for
validation, not for distribution.

What to verify on a real Mac:

- Window renders correctly — the `transparent: true` titlebar needs the
  `macos-private-api` feature + `macOSPrivateApi: true` (both now set). Without
  them the background renders opaque/wrong.
- The custom React titlebar + traffic-light insets line up
  (`set_traffic_lights_inset` in `src-tauri/src/lib.rs`).
- Shelling out to `claude` / `node` resolves — GUI-launched Mac apps get a
  stripped `PATH`, handled by `ensure_macos_path()` in
  `src-tauri/src/core/platform.rs`.

> Note: `macOSPrivateApi` uses private Apple APIs, which rules out Mac App Store
> distribution. Direct distribution via Developer ID (below) is unaffected.

## Phase 2 — code signing + notarization (to ship publicly)

Requires an **Apple Developer Program** membership ($99/yr). Once enrolled:

1. Create a **Developer ID Application** certificate in the Apple Developer
   portal, install it in Keychain, and export it as a `.p12`.
2. Base64-encode the `.p12` for use as a GitHub secret:
   `base64 -i cert.p12 | pbcopy`.
3. Create an **app-specific password** at appleid.apple.com (or an App Store
   Connect API key) for notarization.
4. Add these repository secrets — `tauri-action` consumes them and notarizes
   automatically:

   | Secret | What it is |
   | --- | --- |
   | `APPLE_CERTIFICATE` | base64 of the `.p12` |
   | `APPLE_CERTIFICATE_PASSWORD` | password used when exporting the `.p12` |
   | `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
   | `APPLE_ID` | Apple ID email |
   | `APPLE_PASSWORD` | app-specific password |
   | `APPLE_TEAM_ID` | 10-char team ID |

## Phase 3 — promote to the release pipeline

Add a macOS leg to [`release.yml`](../.github/workflows/release.yml) as a build
matrix (`windows-latest` + `macos-latest`), passing
`--target universal-apple-darwin --bundles app,dmg` and the `APPLE_*` env above.
`includeUpdaterJson: true` adds the `darwin-aarch64` / `darwin-x86_64` entries to
`latest.json` for auto-updates.

Watch out for: both matrix legs write `latest.json` to the same release —
they produce distinct platform keys so `tauri-action`'s merge generally holds,
but verify the final `latest.json` contains every platform after a release.
