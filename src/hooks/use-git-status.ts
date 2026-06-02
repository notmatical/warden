import { useCallback, useEffect, useState } from "react"

import * as ipc from "@/lib/ipc"
import type { RepoStatus } from "@/types"

const REFRESH_MS = 5000

/**
 * Shared per-session git-status polling. Multiple components watching the same
 * session (e.g. its composer and a pane) share one interval and one in-flight
 * request instead of each fanning out its own — so N panes never multiply the
 * IPC load for a session.
 */
interface Entry {
  statuses: RepoStatus[]
  subscribers: Set<(statuses: RepoStatus[]) => void>
  timer: ReturnType<typeof setInterval> | null
  inFlight: boolean
}

const entries = new Map<string, Entry>()

function emit(entry: Entry) {
  for (const fn of entry.subscribers) {
    fn(entry.statuses)
  }
}

function load(sessionId: string) {
  const entry = entries.get(sessionId)
  if (!entry || entry.inFlight) return
  entry.inFlight = true
  ipc
    .sessionGitStatus(sessionId)
    .then((statuses) => {
      entry.statuses = statuses
    })
    .catch(() => {
      entry.statuses = []
    })
    .finally(() => {
      entry.inFlight = false
      emit(entry)
    })
}

// One window-focus listener for the whole app refreshes every active session.
let focusBound = false
function handleFocus() {
  for (const sessionId of entries.keys()) {
    load(sessionId)
  }
}

function subscribe(
  sessionId: string,
  fn: (statuses: RepoStatus[]) => void
): () => void {
  let entry = entries.get(sessionId)
  if (!entry) {
    entry = { statuses: [], subscribers: new Set(), timer: null, inFlight: false }
    entries.set(sessionId, entry)
  }
  entry.subscribers.add(fn)
  if (entry.timer === null) {
    entry.timer = setInterval(() => load(sessionId), REFRESH_MS)
    load(sessionId)
  }
  if (!focusBound) {
    focusBound = true
    window.addEventListener("focus", handleFocus)
  }

  return () => {
    const e = entries.get(sessionId)
    if (!e) return
    e.subscribers.delete(fn)
    if (e.subscribers.size === 0) {
      if (e.timer !== null) clearInterval(e.timer)
      entries.delete(sessionId)
    }
    if (entries.size === 0 && focusBound) {
      focusBound = false
      window.removeEventListener("focus", handleFocus)
    }
  }
}

/** Per-session git status across the session's roots, polled and shared. */
export function useGitStatus(sessionId: string) {
  const [statuses, setStatuses] = useState<RepoStatus[]>(
    () => entries.get(sessionId)?.statuses ?? []
  )

  useEffect(() => {
    setStatuses(entries.get(sessionId)?.statuses ?? [])
    return subscribe(sessionId, setStatuses)
  }, [sessionId])

  const refresh = useCallback(() => load(sessionId), [sessionId])

  return { statuses, refresh }
}
