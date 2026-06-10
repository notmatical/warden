import { useCallback, useEffect, useState } from "react"

import {
  linearBinding,
  linearCachedIssues,
  linearStatus,
  linearSyncNow,
  onLinearChanged,
} from "./ipc"
import type { LinearBinding, LinearIssue } from "./types"

/** Cached Linear issues plus sync controls. Subscribes to the background
 *  poller's change events; callers decide when to load (after checking
 *  connection status) via `loadCached`/`syncNow`. */
export function useLinearIssues() {
  const [issues, setIssues] = useState<LinearIssue[]>([])
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadCached = useCallback(async () => {
    try {
      setIssues(await linearCachedIssues())
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }, [])

  const syncNow = useCallback(async () => {
    setSyncing(true)
    setError(null)
    try {
      setIssues(await linearSyncNow())
    } catch (e) {
      setError(String(e))
    } finally {
      setSyncing(false)
    }
  }, [])

  const clear = useCallback(() => setIssues([]), [])

  // Reload from cache whenever the background poll reconciles new data.
  useEffect(() => {
    let unlisten: (() => void) | undefined
    void onLinearChanged(() => {
      void loadCached()
    }).then((u) => {
      unlisten = u
    })
    return () => unlisten?.()
  }, [loadCached])

  return { issues, syncing, error, loadCached, syncNow, clear }
}

export type FolderLinearPhase = "loading" | "disconnected" | "unbound" | "bound"

/** A folder's Linear linkage: connection status plus its .warden/config.json
 *  binding. `refresh` re-reads both (call after bind/unbind). */
export function useFolderLinearBinding(projectId: string) {
  const [phase, setPhase] = useState<FolderLinearPhase>("loading")
  const [binding, setBinding] = useState<LinearBinding | null>(null)

  const refresh = useCallback(async () => {
    try {
      const { connected } = await linearStatus()
      if (!connected) {
        setPhase("disconnected")
        return
      }
      const bound = await linearBinding(projectId)
      setBinding(bound)
      setPhase(bound ? "bound" : "unbound")
    } catch {
      setPhase("disconnected")
    }
  }, [projectId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { phase, binding, refresh }
}
