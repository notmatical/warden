import type { StateCreator } from "zustand"

import * as ipc from "@/lib/ipc"
import { DEFAULT_CHAT_MODEL } from "@/lib/models"
import { reportError, showRef } from "../shared"
import type { AppState } from "../types"

type GitSlice = Pick<
  AppState,
  "openPullRequest" | "refreshPrStatus" | "syncWorktree" | "checkoutPr"
>

/** Worktree and pull-request actions for a session. Outcomes land on the
 *  session via the session-updated event; `checkoutPr` opens a new one. */
export const createGitSlice: StateCreator<AppState, [], [], GitSlice> = (
  set,
  get
) => ({
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

  checkoutPr: async (projectId, number) => {
    try {
      const session = await ipc.checkoutPr(
        projectId,
        number,
        DEFAULT_CHAT_MODEL
      )
      const groupId = session.groupId
      set((state) => ({
        sessions: { ...state.sessions, [session.id]: session },
        sessionsByGroup: {
          ...state.sessionsByGroup,
          [groupId]: [...(state.sessionsByGroup[groupId] ?? []), session.id],
        },
        openTabs: state.openTabs.includes(session.id)
          ? state.openTabs
          : [...state.openTabs, session.id],
        activeTabId: session.id,
        layout: showRef(state.layout, state.activeTabId, session.id),
        eventsBySession: { ...state.eventsBySession, [session.id]: [] },
      }))
      get().saveView()
      if (get().activeGroupId !== groupId) await get().selectGroup(groupId)
      return session
    } catch (error) {
      reportError("Failed to check out PR", error)
      return null
    }
  },
})
