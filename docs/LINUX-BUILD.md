# Linux builds

Warden ships Linux in three formats — `.deb`, `.rpm`, and a portable
`.AppImage` — all built on `ubuntu-22.04` so binaries link against the oldest
glibc/webkit2gtk we support and run on anything 22.04-or-newer.

## How it's built

- [`release.yml`](../.github/workflows/release.yml) has a Linux matrix leg:
  `tauri-action` builds and uploads deb + rpm, then
  [`scripts/build-appimage.sh`](../scripts/build-appimage.sh) builds the
  AppImage separately, signs it, and attaches it to the same release. A final
  `updater-manifest` job adds the `linux-x86_64` entry to `latest.json` (it has
  to run after every matrix leg so nothing clobbers the manifest).
- [`build-linux.yml`](../.github/workflows/build-linux.yml) is a manual
  `workflow_dispatch` job that produces all three bundles as workflow
  artifacts for testing, mirroring the macOS test workflow.

### Local build

On a Debian/Ubuntu host:

```sh
sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf xdg-utils libfuse2 jq
bun install
bun run tauri build --bundles deb,rpm   # packages
bash scripts/build-appimage.sh          # portable AppImage
```

Arch: `sudo pacman -S webkit2gtk-4.1 librsvg patchelf libayatana-appindicator jq`.

## Runtime WebKitGTK workarounds

WebKitGTK's GPU paths are the dominant source of Linux crash reports for Tauri
apps: blank/white windows on NVIDIA and rolling-release Mesa stacks, and
DMABUF/GBM renderer failures. `init_linux_webview_workarounds()` in
[`src-tauri/src/core/platform.rs`](../src-tauri/src/core/platform.rs) runs
before the first webview spawns and defaults these off:

| Variable | Effect |
| --- | --- |
| `WEBKIT_DISABLE_DMABUF_RENDERER=1` | avoids GBM buffer-sharing failures (NVIDIA, some Mesa) |
| `WEBKIT_DISABLE_COMPOSITING_MODE=1` | avoids white-screen-on-launch from accelerated compositing |

Each is only set **when absent**, so users can pre-set either to reclaim GPU
acceleration. Escape hatches:

- `WARDEN_NO_WEBKIT_WORKAROUNDS=1` — skip all of the above.
- `WARDEN_FORCE_X11=1` — run the GTK backend through XWayland (sets
  `GDK_BACKEND=x11`) for misbehaving Wayland compositors.

## AppImage portability

A stock Tauri AppImage pins `LD_LIBRARY_PATH` to the libraries bundled from the
build host (Ubuntu 22.04), which breaks two ways on newer distros:

1. **GPU stack mismatch** — bundled WebKitGTK against a newer system
   Mesa/driver renders a blank window (Arch, Fedora 40+).
2. **GLib/GIO mismatch** — the host's GIO modules are linked against a newer
   GLib than the bundled copy, so the web process aborts during type
   registration (Ubuntu 24.04+).

[`scripts/appimage-apprun.sh`](../scripts/appimage-apprun.sh) replaces the
launcher: when the host ships WebKitGTK 4.1 itself, it runs against system
libraries (bundled set kept only as resolver fallback, host GIO modules used);
otherwise it runs fully bundled and walls off the host's GIO modules.
`build-appimage.sh` swaps it in after the Tauri build and repackages.

Both build steps run with `NO_STRIP` — linuxdeploy's embedded `strip` predates
RELR relocations (binutils 2.38+) and aborts on `.relr.dyn` sections.

## Updates

Auto-update on Linux works **only for the AppImage** (the updater replaces the
running AppImage file). deb/rpm installs update through the package manager;
the in-app update check fails silently there
([`use-app-update.ts`](../src/hooks/use-app-update.ts) treats any `check()`
error as "no update").

## What to verify on a real Linux box

- Window renders (not white/blank) on at least one NVIDIA and one Wayland
  setup; `transparent: true` + no decorations may render square corners on
  some compositors — cosmetic, acceptable.
- Custom titlebar window controls (min/max/close) work — Linux takes the same
  `WindowControls` path as Windows.
- "Open in terminal" finds an emulator (`$TERMINAL` is honored first).
- Secrets round-trip through the Secret Service keyring (D-Bus) — the
  `keyring` crate is already built with `sync-secret-service`.
- AppImage launches on a distro **newer** than 22.04 (Ubuntu 24.04, Fedora,
  Arch) and on stock Ubuntu 22.04.

## Known limits / follow-ups

- x86_64 only for now. An arm64 leg is mostly a matrix row on an
  `ubuntu-22.04-arm` runner plus a `linux-aarch64` manifest entry —
  `build-appimage.sh` already handles the arch naming.
- `tauri-plugin-decorum` is a no-op on Linux (Windows/macOS plugin); the
  maximize button's Snap Layout overlay simply doesn't apply.
