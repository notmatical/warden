import type { KeyCombo } from "@/lib/keybindings"

/** Stable identity for an app action. Keys bind to these, not to handlers, so a
 *  settings UI can remap them and a command palette can invoke them. */
export type CommandId =
  | "palette.toggle"
  | "sidebar.toggle"
  | "session.cancel"
  | "session.cycleMode"
  | "composer.toggleModelMenu"

export interface CommandDef {
  title: string
  category: string
  defaultCombo: KeyCombo
  /** Fire even while a text field is focused. */
  allowInInput?: boolean
}

export const COMMANDS: Record<CommandId, CommandDef> = {
  "palette.toggle": {
    title: "Open command palette",
    category: "View",
    defaultCombo: { key: "k", mod: true },
    allowInInput: true,
  },
  "sidebar.toggle": {
    title: "Toggle sidebar",
    category: "View",
    defaultCombo: { key: "b", mod: true },
    allowInInput: true,
  },
  "session.cancel": {
    title: "Cancel the active turn",
    category: "Session",
    defaultCombo: { key: "Escape" },
    allowInInput: true,
  },
  "session.cycleMode": {
    title: "Cycle execution mode",
    category: "Session",
    defaultCombo: { key: "Tab", shift: true },
    allowInInput: true,
  },
  "composer.toggleModelMenu": {
    title: "Toggle model menu",
    category: "Composer",
    defaultCombo: { key: "e", mod: true },
    allowInInput: true,
  },
}

export const COMMAND_IDS = Object.keys(COMMANDS) as CommandId[]

// ----- configurable bindings (defaults + persisted overrides) ----------------

const OVERRIDES_KEY = "warden:keybindings"
type Overrides = Partial<Record<CommandId, KeyCombo>>

function readOverrides(): Overrides {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDES_KEY) ?? "{}") as Overrides
  } catch {
    return {}
  }
}

let overrides: Overrides = readOverrides()

/** The combo currently bound to a command (user override, else default). */
export function resolveCombo(id: CommandId): KeyCombo {
  return overrides[id] ?? COMMANDS[id].defaultCombo
}

/** Rebind (or reset, with `null`) a command — for the keybinding settings UI. */
export function setCombo(id: CommandId, combo: KeyCombo | null): void {
  overrides = { ...overrides }
  if (combo) overrides[id] = combo
  else delete overrides[id]
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides))
  } catch {
    // ignore storage failures
  }
}

// ----- UI command bus (targeted intents) -------------------------------------
//
// Some commands act on a specific component (e.g. open the active composer's
// model menu). Rather than route through global state — which would re-render
// every subscriber — components subscribe here and receive a payload directly.

type Listener = (payload: unknown) => void
const listeners = new Map<CommandId, Set<Listener>>()

export function emitUiCommand<T>(id: CommandId, payload: T): void {
  listeners.get(id)?.forEach((fn) => {
    fn(payload)
  })
}

export function subscribeUiCommand<T>(
  id: CommandId,
  fn: (payload: T) => void
): () => void {
  let set = listeners.get(id)
  if (!set) {
    set = new Set()
    listeners.set(id, set)
  }
  const listener = fn as Listener
  set.add(listener)
  return () => {
    set.delete(listener)
  }
}
