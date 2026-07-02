import { relaunch } from "@tauri-apps/plugin-process"
import { check, type Update } from "@tauri-apps/plugin-updater"
import { useEffect, useState } from "react"

/** Checks for a Warden app update on launch via the Tauri updater. Returns the
 *  pending update (if any) plus an installer that downloads it and relaunches.
 *  Silent outside a Tauri runtime (web preview), when the updater isn't
 *  configured, or when offline. */
export function useAppUpdate() {
  const [update, setUpdate] = useState<Update | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const found = await check()
        if (found && !cancelled) setUpdate(found)
      } catch {
        // No updater runtime / not configured / offline — stay quiet.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const install = async () => {
    if (!update) return
    setInstalling(true)
    try {
      await update.downloadAndInstall()
      await relaunch()
    } catch {
      // Surface failure by re-enabling the button; the toast layer can be
      // added later if we want explicit error reporting.
      setInstalling(false)
    }
  }

  return { update, installing, install }
}
