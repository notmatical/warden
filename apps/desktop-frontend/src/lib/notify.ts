import { emitTo, listen } from "@tauri-apps/api/event"
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification"
import { useSyncExternalStore } from "react"
import { isSoundName, playSound, type SoundName } from "@/lib/sounds"

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

// ---------------------------------------------------------------------------
// Toast payloads shared between the main and notification windows
// ---------------------------------------------------------------------------

export type NotifyEvent =
  | "sessionDone"
  | "workflowDone"
  | "prChecks"
  | "linearAssigned"

/** What clicking a toast should open back in the main window. */
export type NotifyTarget =
  | { kind: "session"; id: string }
  | { kind: "workflow"; id: string }
  | { kind: "url"; url: string }

export type ToastPayload = {
  id: string
  /** Picks the toast icon; generic notifications omit it. */
  event?: NotifyEvent
  title: string
  body?: string
  target?: NotifyTarget
  /** Render with the destructive accent (failed checks, errored agents). */
  tone?: "default" | "error"
}

export type NotifyOptions = {
  /** Makes the toast click-to-open in the main window. */
  target?: NotifyTarget
  /** "error" renders the destructive accent and plays the error sound. */
  tone?: "default" | "error"
  /** Force a specific sound, overriding the tone/preference default. */
  sound?: SoundName
}

/** main → notifications window: show a toast. */
export const NOTIFY_SHOW = "warden://notify-show"
/** notifications → main window: a toast was clicked. */
export const NOTIFY_ACTIVATED = "warden://notify-activated"
/** backend → main window: show a notification (see events.rs). */
export const NOTIFY_REQUEST = "warden://notify-request"
/** Handshake: main pings until the notification webview answers. */
export const NOTIFY_PING = "warden://notify-ping"
export const NOTIFY_PONG = "warden://notify-pong"

export const NOTIFICATIONS_WINDOW = "notifications"
export const MAIN_WINDOW = "main"

// ---------------------------------------------------------------------------
// Popup-window readiness handshake
//
// The notifications webview loads in parallel with the main window, and Tauri
// events are fire-and-forget — anything emitted before its listener registers
// is lost. So the first dispatch pings until the popup answers, and payloads
// queue in the meantime. Notifications that can fire at launch (e.g. Linear
// assignments made while the app was closed) survive the race.
// ---------------------------------------------------------------------------

let popupReady: Promise<boolean> | null = null

function ensurePopupReady(): Promise<boolean> {
  popupReady ??= new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    listen(NOTIFY_PONG, () => finish(true))
      .then((unlisten) => {
        let attempts = 0
        const ping = () => {
          if (settled) {
            unlisten()
            return
          }
          if (attempts++ >= 40) {
            unlisten()
            finish(false)
            return
          }
          void emitTo(NOTIFICATIONS_WINDOW, NOTIFY_PING).catch(() => {})
          setTimeout(ping, 250)
        }
        ping()
      })
      .catch(() => finish(false))
  })
  return popupReady
}

/** Show a native OS notification. Best-effort: a no-op if permission is denied,
 *  and never throws into the UI. */
async function notifyNative(title: string, body?: string): Promise<void> {
  try {
    if (!(await ensurePermission())) return
    sendNotification({ title, body })
  } catch {
    // Notifications are best-effort.
  }
}

let toastSeq = 0

/** Show a styled Warden toast in the always-on-top notifications window,
 *  falling back to a native OS notification if the popup never came up. */
async function showToast(payload: Omit<ToastPayload, "id">): Promise<void> {
  try {
    if (await ensurePopupReady()) {
      await emitTo(NOTIFICATIONS_WINDOW, NOTIFY_SHOW, {
        ...payload,
        id: `toast-${++toastSeq}`,
      } satisfies ToastPayload)
      return
    }
  } catch {
    // fall through to the native path
  }
  await notifyNative(payload.title, payload.body)
}

/** General-purpose notification: styled popup toast + sound, from anywhere in
 *  the renderer. Not gated by the per-event preference toggles — use
 *  `notifyFor` for the standard app events so users keep control of them. */
export async function notify(
  title: string,
  body?: string,
  options?: NotifyOptions
): Promise<void> {
  playSound(
    options?.sound ?? (options?.tone === "error" ? "error" : "notify"),
    cached.volume
  )
  await showToast({
    title,
    body,
    target: options?.target,
    tone: options?.tone,
  })
}

// ---------------------------------------------------------------------------
// Per-event preferences (localStorage; pure UI prefs, default all-on)
// ---------------------------------------------------------------------------

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
    label: "Pull requests",
    hint: "CI checks settled on one of your open PRs, or a PR merged.",
  },
  {
    event: "linearAssigned",
    label: "Linear assignments",
    hint: "A Linear issue was newly assigned to you.",
  },
]

const PREFS_KEY = "warden:notification-prefs"

export type EventPref = { enabled: boolean; sound: SoundName }

export type NotifyPrefs = {
  /** Master sound volume, 0–1. */
  volume: number
  events: Record<NotifyEvent, EventPref>
}

const DEFAULT_PREFS: NotifyPrefs = {
  volume: 0.5,
  events: {
    sessionDone: { enabled: true, sound: "notify" },
    workflowDone: { enabled: true, sound: "notify" },
    prChecks: { enabled: true, sound: "notify" },
    linearAssigned: { enabled: true, sound: "notify" },
  },
}

function readPrefs(): NotifyPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Record<string, unknown>
    // v1 stored a flat Record<NotifyEvent, boolean>; carry the toggles over.
    if (typeof parsed.events !== "object" || parsed.events === null) {
      const events = { ...DEFAULT_PREFS.events }
      for (const key of Object.keys(events) as NotifyEvent[]) {
        if (typeof parsed[key] === "boolean")
          events[key] = { ...events[key], enabled: parsed[key] }
      }
      return { ...DEFAULT_PREFS, events }
    }
    const stored = parsed as unknown as Partial<NotifyPrefs>
    const events = { ...DEFAULT_PREFS.events }
    for (const key of Object.keys(events) as NotifyEvent[]) {
      const pref = stored.events?.[key]
      if (!pref) continue
      events[key] = {
        enabled:
          typeof pref.enabled === "boolean"
            ? pref.enabled
            : events[key].enabled,
        // Persisted sounds can name options that no longer exist.
        sound: isSoundName(pref.sound) ? pref.sound : events[key].sound,
      }
    }
    return {
      volume:
        typeof stored.volume === "number"
          ? Math.max(0, Math.min(1, stored.volume))
          : DEFAULT_PREFS.volume,
      events,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

let cached: NotifyPrefs = readPrefs()
const listeners = new Set<() => void>()

function writePrefs(next: NotifyPrefs): void {
  cached = next
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(cached))
  } catch {
    // persistence is best-effort
  }
  for (const listener of listeners) listener()
}

export function notifyEnabled(event: NotifyEvent): boolean {
  return cached.events[event].enabled
}

export function setNotifyEnabled(event: NotifyEvent, on: boolean): void {
  writePrefs({
    ...cached,
    events: {
      ...cached.events,
      [event]: { ...cached.events[event], enabled: on },
    },
  })
}

export function setNotifySound(event: NotifyEvent, sound: SoundName): void {
  writePrefs({
    ...cached,
    events: { ...cached.events, [event]: { ...cached.events[event], sound } },
  })
}

export function setNotifyVolume(volume: number): void {
  writePrefs({ ...cached, volume: Math.max(0, Math.min(1, volume)) })
}

/** Live notification prefs for the settings UI. */
export function useNotifyPrefs(): NotifyPrefs {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    () => cached
  )
}

/** Fire a sample toast through the full pipeline — settings "Test" button. */
export function notifyTest(): void {
  playSound(cached.events.sessionDone.sound, cached.volume)
  void showToast({
    event: "sessionDone",
    title: "Test notification",
    body: "This is how Warden notifications look.",
  })
}

/** What the Rust side sends on NOTIFY_REQUEST (see core/events.rs). Loosely
 *  typed at the boundary; unknown event/sound names degrade gracefully. */
export type BackendNotification = {
  title: string
  body?: string
  event?: string
  tone?: string
  sound?: string
  target?: NotifyTarget
}

/** Route a backend notification through the standard pipeline: pref-gated
 *  when it names a known event, unconditional otherwise. */
export function handleBackendNotification(payload: BackendNotification): void {
  const options: NotifyOptions = {
    target: payload.target,
    tone: payload.tone === "error" ? "error" : undefined,
    sound: isSoundName(payload.sound) ? payload.sound : undefined,
  }
  const event = NOTIFY_EVENTS.find((e) => e.event === payload.event)?.event
  if (event) void notifyFor(event, payload.title, payload.body, options)
  else void notify(payload.title, payload.body, options)
}

/** `notify`, gated by the event's preference toggle and using the event's
 *  configured sound (unless `options.sound` forces one). */
export async function notifyFor(
  event: NotifyEvent,
  title: string,
  body?: string,
  options?: NotifyOptions
): Promise<void> {
  if (!notifyEnabled(event)) return
  const pref = cached.events[event].sound
  // Explicit override wins; otherwise error-toned notifications get the
  // error sound, and an event set to "none" stays silent.
  const sound =
    options?.sound ??
    (options?.tone === "error" && pref !== "none" ? "error" : pref)
  playSound(sound, cached.volume)
  await showToast({
    event,
    title,
    body,
    target: options?.target,
    tone: options?.tone,
  })
}
