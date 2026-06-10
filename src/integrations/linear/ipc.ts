import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

import type {
  LinearBinding,
  LinearComment,
  LinearIssue,
  LinearStatus,
  LinearTeam,
  ProjectLinearBinding,
  Viewer,
} from "./types"

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

/** Move an issue to its team's primary "started" state (writeback on send). */
export function linearStartIssue(issueId: string, teamId: string): Promise<void> {
  return invoke("linear_start_issue", { issueId, teamId })
}

/** Comments for one issue, fetched live (not cached), oldest first. */
export function linearIssueComments(issueId: string): Promise<LinearComment[]> {
  return invoke("linear_issue_comments", { issueId })
}

/** Teams (with their projects) visible to the user — for the binding picker. */
export function linearTeams(): Promise<LinearTeam[]> {
  return invoke("linear_teams")
}

/** A project's Linear binding from its .warden/config.json, if any. */
export function linearBinding(
  projectId: string
): Promise<LinearBinding | null> {
  return invoke("linear_binding", { projectId })
}

/** Every known project that carries a Linear binding. */
export function linearBindings(): Promise<ProjectLinearBinding[]> {
  return invoke("linear_bindings")
}

/** Write (or remove, with null) a project's Linear binding. */
export function linearSetBinding(
  projectId: string,
  binding: LinearBinding | null
): Promise<void> {
  return invoke("linear_set_binding", { projectId, binding })
}

/** Subscribe to background-sync change notifications. */
export function onLinearChanged(handler: () => void): Promise<UnlistenFn> {
  return listen("linear-issues-changed", () => handler())
}
