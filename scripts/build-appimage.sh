#!/usr/bin/env bash
# Builds the Linux AppImage with the distro-portable launcher from
# scripts/appimage-apprun.sh swapped in, so one binary runs across distros.
#
# Why `tauri build --bundles appimage` alone isn't enough:
#   * linuxdeploy embeds a `strip` that predates RELR relocations
#     (binutils 2.38+) and aborts on `.relr.dyn` sections -> NO_STRIP for
#     both the initial build and the repack.
#   * The stock AppRun pins LD_LIBRARY_PATH to the bundled (build-host)
#     libraries, which breaks on newer distros; see appimage-apprun.sh.
#
# Outputs, under src-tauri/target/release/bundle/appimage/:
#   Warden_<version>_<arch>.AppImage        the repackaged AppImage
#   Warden_<version>_<arch>.AppImage.sig    updater signature (when
#                                           TAURI_SIGNING_PRIVATE_KEY is set)
#
# Requires a Linux host with the Tauri build prerequisites plus `jq`.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE_DIR="$ROOT/target/release/bundle/appimage"
APPRUN="$ROOT/scripts/appimage-apprun.sh"
MACHINE="$(uname -m)"

if [ "$(uname -s)" != "Linux" ]; then
    echo "error: AppImages can only be built on a Linux host" >&2
    exit 1
fi

echo "==> building AppImage via tauri (NO_STRIP for RELR compatibility)"
(cd "$ROOT" && NO_STRIP=true bun run tauri build --bundles appimage)

APPDIR="$(find "$BUNDLE_DIR" -maxdepth 1 -name '*.AppDir' -type d | head -n 1)"
if [ -z "$APPDIR" ]; then
    echo "error: no AppDir found under $BUNDLE_DIR" >&2
    exit 1
fi

echo "==> installing distro-portable AppRun"
install -m 0755 "$APPRUN" "$APPDIR/AppRun"

# Tauri downloads and caches the linuxdeploy AppImage plugin during the build
# above; reuse it for the repack, fetching it ourselves only if missing.
PLUGIN="$HOME/.cache/tauri/linuxdeploy-plugin-appimage.AppImage"
if [ ! -x "$PLUGIN" ]; then
    echo "==> linuxdeploy plugin not cached; downloading"
    mkdir -p "$(dirname "$PLUGIN")"
    curl -fsSL -o "$PLUGIN" \
        "https://github.com/linuxdeploy/linuxdeploy-plugin-appimage/releases/download/continuous/linuxdeploy-plugin-appimage-${MACHINE}.AppImage"
    chmod +x "$PLUGIN"
fi

echo "==> repackaging with replacement AppRun"
(
    cd "$BUNDLE_DIR"
    rm -f ./*.AppImage ./*.AppImage.sig
    NO_STRIP=1 ARCH="$MACHINE" "$PLUGIN" --appdir "$(basename "$APPDIR")"
)

VERSION="$(jq -r .version "$ROOT/apps/desktop/tauri.conf.json")"
case "$MACHINE" in
    x86_64) ARCH_LABEL="amd64" ;;
    aarch64) ARCH_LABEL="arm64" ;;
    *) ARCH_LABEL="$MACHINE" ;;
esac

OUTPUT="$(find "$BUNDLE_DIR" -maxdepth 1 -name '*.AppImage' -type f | head -n 1)"
if [ -z "$OUTPUT" ]; then
    echo "error: repackaging produced no AppImage" >&2
    exit 1
fi
FINAL="$BUNDLE_DIR/Warden_${VERSION}_${ARCH_LABEL}.AppImage"
mv "$OUTPUT" "$FINAL"

if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
    echo "==> signing updater artifact"
    # Pass the key/password via env (tauri signer reads TAURI_SIGNING_*),
    # not as CLI flags: an empty --password "" arg gets dropped by `bun run`,
    # which would then swallow the FILE path as the password value.
    (cd "$ROOT" && \
        TAURI_SIGNING_PRIVATE_KEY="$TAURI_SIGNING_PRIVATE_KEY" \
        TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" \
        bun run tauri signer sign "$FINAL")
else
    echo "warning: TAURI_SIGNING_PRIVATE_KEY unset; skipping updater signature" >&2
fi

echo "==> done: $FINAL"
