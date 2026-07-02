import { platform } from "@tauri-apps/plugin-os"

const MAC_PATTERN = /mac|iphone|ipad|ipod/i
const WIN_PATTERN = /win/i
const LINUX_PATTERN = /linux|x11/i

/** Match the Tauri OS plugin (synchronous + authoritative on desktop) against
 *  `expected`, falling back to a UA sniff for non-Tauri contexts (`dev:web`). */
function detectPlatform(
  expected: ReturnType<typeof platform>,
  fallback: RegExp
): boolean {
  try {
    return platform() === expected
  } catch {
    if (typeof navigator === "undefined") return false
    return fallback.test(navigator.platform || navigator.userAgent || "")
  }
}

/** The current OS. Evaluated once — the platform never changes mid-session. */
export const isMac = detectPlatform("macos", MAC_PATTERN)
export const isWindows = detectPlatform("windows", WIN_PATTERN)
export const isLinux = detectPlatform("linux", LINUX_PATTERN)

/** Whether we're running inside the Tauri webview (vs. `dev:web` in a browser).
 *  Gates native-window calls that only exist in the desktop shell. */
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

/** The platform's primary modifier key glyph. */
export const MOD_KEY = isMac ? "⌘" : "Ctrl"

/** Render a modifier+key shortcut for display, e.g. `⌘3` (mac) or `Ctrl+3`. */
export function modShortcut(key: string): string {
  return isMac ? `${MOD_KEY}${key}` : `${MOD_KEY}+${key}`
}
