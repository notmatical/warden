import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification"

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
