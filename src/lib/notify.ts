import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification"
import { useSyncExternalStore } from "react"

let granted: boolean | null = null

async function ensurePermission(): Promise<boolean> {
  if (granted !== null) return granted
  granted = await isPermissionGranted()
  if (!granted) {
    granted = (await requestPermission()) === "granted"
  }
  return granted
}

/** Whether the app window is currently in the foreground. */
export function windowFocused(): boolean {
  return typeof document !== "undefined" && document.hasFocus()
}

/** Show a native OS notification. Best-effort: a no-op if permission is denied,
 *  and never throws into the UI. */
export async function notify(title: string, body?: string): Promise<void> {
  try {
    if (!(await ensurePermission())) return
    sendNotification({ title, body })
  } catch {
    // Notifications are best-effort.
  }
}

// ---------------------------------------------------------------------------
// Per-event preferences (localStorage; pure UI prefs, default all-on)
// ---------------------------------------------------------------------------

export type NotifyEvent =
  | "sessionDone"
  | "workflowDone"
  | "prChecks"
  | "linearAssigned"

export const NOTIFY_EVENTS: {
  event: NotifyEvent
  label: string
  hint: string
}[] = [
  {
    event: "sessionDone",
    label: "Agent finished",
    hint: "A session's turn completed or stopped on an error.",
  },
  {
    event: "workflowDone",
    label: "Workflow updates",
    hint: "A workflow finished, failed, or is waiting at a gate.",
  },
  {
    event: "prChecks",
    label: "PR checks",
    hint: "CI checks on one of your open PRs passed or failed.",
  },
  {
    event: "linearAssigned",
    label: "Linear assignments",
    hint: "A Linear issue was newly assigned to you.",
  },
]

const PREFS_KEY = "warden:notification-prefs"

type Prefs = Record<NotifyEvent, boolean>

const DEFAULT_PREFS: Prefs = {
  sessionDone: true,
  workflowDone: true,
  prChecks: true,
  linearAssigned: true,
}

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) }
  } catch {
    return DEFAULT_PREFS
  }
}

let cached: Prefs = readPrefs()
const listeners = new Set<() => void>()

export function notifyEnabled(event: NotifyEvent): boolean {
  return cached[event]
}

export function setNotifyEnabled(event: NotifyEvent, on: boolean): void {
  cached = { ...cached, [event]: on }
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(cached))
  } catch {
    // persistence is best-effort
  }
  for (const listener of listeners) listener()
}

/** Live notification prefs for the settings UI. */
export function useNotifyPrefs(): Prefs {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    () => cached
  )
}

/** `notify`, gated by the event's preference toggle. */
export async function notifyFor(
  event: NotifyEvent,
  title: string,
  body?: string
): Promise<void> {
  if (!notifyEnabled(event)) return
  await notify(title, body)
}
