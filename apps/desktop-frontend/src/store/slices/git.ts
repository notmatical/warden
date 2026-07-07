import type { StateCreator } from "zustand"

import * as ipc from "@/lib/ipc"
import { reportError } from "../shared"
import type { AppState } from "../types"

type GitSlice = Pick<
  AppState,
  "openPullRequest" | "refreshPrStatus" | "syncWorktree"
>

/** Worktree and pull-request actions for a session. Outcomes land on the
 *  session via the session-updated event. */
export const createGitSlice: StateCreator<AppState, [], [], GitSlice> = () => ({
  openPullRequest: async (sessionId, title, body, draft) => {
    // Success records the PR on the session via the session-updated event.
    try {
      return await ipc.openPullRequest(sessionId, title, body, draft)
    } catch (error) {
      reportError("Failed to open pull request", error)
      return null
    }
  },

  refreshPrStatus: async (sessionId) => {
    try {
      return await ipc.refreshPrStatus(sessionId)
    } catch {
      return null
    }
  },

  syncWorktree: async (sessionId, mode) => {
    try {
      return await ipc.syncWorktree(sessionId, mode)
    } catch (error) {
      reportError("Failed to sync with base", error)
      return null
    }
  },
})
