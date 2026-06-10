#!/usr/bin/env bash
# Replacement AppRun launcher for the Warden AppImage.
#
# The stock linuxdeploy launcher forces the bundled (build-host) libraries to
# the front of LD_LIBRARY_PATH. Those libraries come from the Ubuntu LTS image
# the release is built on, and pinning them breaks newer distros in two ways:
#
#   * GPU stack mismatch: the bundled WebKitGTK against a newer system
#     Mesa/driver combination renders a blank window (Arch, Fedora 40+, ...).
#   * GLib/GIO mismatch: the host's GIO modules are linked against a newer
#     GLib than the bundled copy, so the web process aborts during type
#     registration (seen on Ubuntu 24.04+).
#
# Strategy: when the host ships WebKitGTK 4.1 itself, run against the system
# libraries and keep the bundled set only as a resolver fallback; otherwise run
# fully bundled and wall off the host's GIO modules.

set -eu

SELF="$(readlink -f "$0")"
APPDIR="${SELF%/*}"
export APPDIR

TRIPLET="$(uname -m)-linux-gnu"
BUNDLED_LIBS="$APPDIR/usr/lib:$APPDIR/usr/lib/$TRIPLET:$APPDIR/usr/lib64:$APPDIR/lib:$APPDIR/lib/$TRIPLET"
SYSTEM_LIBS="/usr/lib/$TRIPLET:/lib/$TRIPLET:/usr/lib:/usr/lib64"
USER_LIBS="${LD_LIBRARY_PATH:-}"

# linuxdeploy's GTK hook dereferences XDG_DATA_DIRS, which Wayland sessions can
# leave unset; give it a sane default before sourcing (set -u would abort).
export XDG_DATA_DIRS="${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"

# Source the linuxdeploy hooks (GDK/GTK pixbuf loaders, themes, ...).
for hook in "$APPDIR"/apprun-hooks/*.sh; do
    if [ -f "$hook" ]; then
        . "$hook"
    fi
done

has_system_webkit() {
    for dir in "/usr/lib/$TRIPLET" /usr/lib64 /usr/lib; do
        if [ -e "$dir/libwebkit2gtk-4.1.so.0" ]; then
            return 0
        fi
    done
    return 1
}

if has_system_webkit; then
    export LD_LIBRARY_PATH="$SYSTEM_LIBS:$BUNDLED_LIBS"
    # The GTK hook points this at bundled GIO modules built against the old
    # bundled GLib; with the system GLib loaded they must not be mixed in.
    unset GIO_EXTRA_MODULES
else
    export LD_LIBRARY_PATH="$BUNDLED_LIBS"
    # Running on the bundled GLib: the host's GIO modules may require newer
    # GLib symbols than we ship, so don't load any module directory at all.
    export GIO_MODULE_DIR=/dev/null
fi

# Anything the user had in LD_LIBRARY_PATH still resolves, last.
if [ -n "$USER_LIBS" ]; then
    export LD_LIBRARY_PATH="$LD_LIBRARY_PATH:$USER_LIBS"
fi

export PATH="$APPDIR/usr/bin:$PATH"
export XDG_DATA_DIRS="$APPDIR/usr/share:$XDG_DATA_DIRS"

for bin in "$APPDIR/usr/bin/Warden" "$APPDIR/usr/bin/warden"; do
    if [ -x "$bin" ]; then
        exec "$bin" "$@"
    fi
done

echo "AppRun: application binary not found under $APPDIR/usr/bin" >&2
exit 1
