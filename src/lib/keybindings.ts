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

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"])

/** Whether the event originated from a text-entry element. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return EDITABLE_TAGS.has(target.tagName) || target.isContentEditable
}

/** A single display label for a combo, e.g. "Cmd+E" (mac) or "Ctrl+E". */
export function comboLabel(combo: KeyCombo): string {
  const parts: string[] = []
  if (combo.mod) parts.push(isMac ? "Cmd" : "Ctrl")
  if (combo.ctrl) parts.push("Ctrl")
  if (combo.meta) parts.push("Cmd")
  if (combo.alt) parts.push(isMac ? "Opt" : "Alt")
  if (combo.shift) parts.push("Shift")
  if (combo.key === " ") {
    parts.push("Space")
  } else {
    // Single keys read nicest uppercased ("E"); named keys keep their casing.
    parts.push(combo.key.length === 1 ? combo.key.toUpperCase() : combo.key)
  }
  return parts.join(" + ")
}
