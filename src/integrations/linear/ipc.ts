import { invoke } from "@tauri-apps/api/core"

import type { LinearIssue, LinearStatus, Viewer } from "./types"

/** Validate a personal API key against Linear and store it in the OS keychain. */
export function linearConnect(key: string): Promise<Viewer> {
  return invoke("linear_connect", { key })
}

/** Forget the stored API key. */
export function linearDisconnect(): Promise<void> {
  return invoke("linear_disconnect")
}

/** Whether a Linear key is stored (no network call). */
export function linearStatus(): Promise<LinearStatus> {
  return invoke("linear_status")
}

/** Issues assigned to the authenticated user. */
export function linearListIssues(): Promise<LinearIssue[]> {
  return invoke("linear_list_issues")
}
