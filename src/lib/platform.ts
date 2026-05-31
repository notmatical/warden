import { platform } from "@tauri-apps/plugin-os"

const MAC_PATTERN = /mac|iphone|ipad|ipod/i

function detectIsMac(): boolean {
  try {
    // Tauri's OS plugin is synchronous in v2 and authoritative on desktop.
    return platform() === "macos"
  } catch {
    // Fallback for non-Tauri contexts (e.g. `bun run dev:web` in a browser).
    if (typeof navigator === "undefined") return false
    return MAC_PATTERN.test(navigator.platform || navigator.userAgent || "")
  }
}

/** Whether we're on macOS. Evaluated once — the platform never changes. */
export const isMac = detectIsMac()

/** The platform's primary modifier key glyph. */
export const MOD_KEY = isMac ? "⌘" : "Ctrl"

/** Render a modifier+key shortcut for display, e.g. `⌘3` (mac) or `Ctrl+3`. */
export function modShortcut(key: string): string {
  return isMac ? `${MOD_KEY}${key}` : `${MOD_KEY}+${key}`
}
