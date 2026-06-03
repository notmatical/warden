import { isMac } from "@/lib/platform"

/** A key combination. `mod` is the platform's primary modifier (⌘ on macOS,
 *  Ctrl elsewhere); prefer it over hardcoding `ctrl`/`meta`. */
export interface KeyCombo {
  key: string
  shift?: boolean
  alt?: boolean
  ctrl?: boolean
  meta?: boolean
  mod?: boolean
}

export type KeyHandler = (event: KeyboardEvent) => void

export interface Keybinding {
  id: string
  combo: KeyCombo
  handler: KeyHandler
  /** Fire even while an input/textarea is focused. Default false. */
  allowInInput?: boolean
  /** Human-readable label for a future shortcuts cheatsheet. */
  description?: string
}

/** Whether a keyboard event exactly matches a combo (modifiers must agree). */
export function matchCombo(combo: KeyCombo, event: KeyboardEvent): boolean {
  if (event.key.toLowerCase() !== combo.key.toLowerCase()) return false

  let ctrl = !!combo.ctrl
  let meta = !!combo.meta
  if (combo.mod) {
    if (isMac) meta = true
    else ctrl = true
  }

  return (
    event.shiftKey === !!combo.shift &&
    event.altKey === !!combo.alt &&
    event.ctrlKey === ctrl &&
    event.metaKey === meta
  )
}

/** A stable string identity for a combo, for use as an effect dependency. */
export function serializeCombo(combo: KeyCombo): string {
  return [
    combo.mod && "mod",
    combo.ctrl && "ctrl",
    combo.meta && "meta",
    combo.alt && "alt",
    combo.shift && "shift",
    combo.key.toLowerCase(),
  ]
    .filter(Boolean)
    .join("+")
}

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"])

/** Whether the event originated from a text-entry element. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return EDITABLE_TAGS.has(target.tagName) || target.isContentEditable
}

/** A single display label for a combo, e.g. "CMD+E" (mac) or "CTRL+E". */
export function comboLabel(combo: KeyCombo): string {
  const parts: string[] = []
  if (combo.mod) parts.push(isMac ? "CMD" : "CTRL")
  if (combo.ctrl) parts.push("CTRL")
  if (combo.meta) parts.push("CMD")
  if (combo.alt) parts.push(isMac ? "OPT" : "ALT")
  if (combo.shift) parts.push("SHIFT")
  parts.push(combo.key === " " ? "SPACE" : combo.key.toUpperCase())
  return parts.join("+")
}
