import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

import type { LinearIssue, LinearStatus, Viewer } from "./types"

/** Validate a personal API key against Linear and store it in the OS keychain. */
export function linearConnect(key: string): Promise<Viewer> {
  return invoke("linear_connect", { key })
}

/** Forget the stored API key and clear the cached inbox. */
export function linearDisconnect(): Promise<void> {
  return invoke("linear_disconnect")
}

/** Whether a Linear key is stored (no network call). */
export function linearStatus(): Promise<LinearStatus> {
  return invoke("linear_status")
}

/** The cached inbox, read from the local DB — instant, offline. */
export function linearCachedIssues(): Promise<LinearIssue[]> {
  return invoke("linear_cached_issues")
}

/** Force a sync against Linear and return the freshened cache. */
export function linearSyncNow(): Promise<LinearIssue[]> {
  return invoke("linear_sync_now")
}

/** Subscribe to background-sync change notifications. */
export function onLinearChanged(handler: () => void): Promise<UnlistenFn> {
  return listen("linear-issues-changed", () => handler())
}
