import { create } from "zustand"
import { devtools } from "zustand/middleware"

import {
  onAgentDelta,
  onAgentEvent,
  onSessionUpdated,
  onWorkflowRun,
} from "@/lib/events"
import * as ipc from "@/lib/ipc"
import { reportError } from "./shared"
import { createGitSlice } from "./slices/git"
import { createGroupsSlice } from "./slices/groups"
import { createProvidersSlice } from "./slices/providers"
import { createSessionsSlice } from "./slices/sessions"
import { createTranscriptSlice } from "./slices/transcript"
import { createUiSlice } from "./slices/ui"
import { createViewportSlice } from "./slices/viewport"
import { createWorkflowsSlice } from "./slices/workflows"
import type { AppState } from "./types"

export type {
  CreateSessionOptions,
  RunPlanToCodeOptions,
  SessionSettingsPatch,
} from "./types"

// Tauri event listeners are process-global; wire them once.
let listenersWired = false

/** The application store, assembled from domain slices (see ./slices). Each
 *  slice is typed over the whole AppState, so cross-slice calls go through
 *  get(); this file owns only app init and the one-time event wiring.
 *
 *  Wrapped with `devtools` so the Redux DevTools browser extension can inspect
 *  and time-travel through state changes in development. */
export const useAppStore = create<AppState>()(
  devtools(
    (set, get, store) => ({
      ...createUiSlice(set, get, store),
      ...createProvidersSlice(set, get, store),
      ...createGroupsSlice(set, get, store),
      ...createGitSlice(set, get, store),
      ...createViewportSlice(set, get, store),
      ...createSessionsSlice(set, get, store),
      ...createTranscriptSlice(set, get, store),
      ...createWorkflowsSlice(set, get, store),

      initialized: false,

      init: async () => {
        if (get().initialized) {
          return
        }
        set({ initialized: true })

        if (!listenersWired) {
          listenersWired = true
          onAgentEvent((record) => get().onAgentEvent(record))
          onAgentDelta((payload) => get().onDelta(payload))
          onSessionUpdated((session) => get().onSessionUpdated(session))
          onWorkflowRun((view) => get().applyWorkflowRun(view))
          // Re-probe providers when the window regains focus, so installs or
          // logins done outside the app are reflected without a restart.
          window.addEventListener("focus", () => void get().loadProviders())
        }

        void get().loadProviders()

        set({ loadingGroups: true })
        try {
          const groups = await ipc.listGroups()
          set({ groups, activeGroupId: groups[0]?.id ?? null })
          // The viewport is global, so every group's sessions must be loaded for a
          // restored tab (from any group) to resolve.
          await Promise.all(groups.map((g) => get().loadGroupData(g.id)))
          get().restoreView()
        } catch (error) {
          reportError("Failed to load groups", error)
        } finally {
          set({ loadingGroups: false })
        }
      },
    }),
    { name: "warden" }
  )
)
