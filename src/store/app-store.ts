import { listen } from "@tauri-apps/api/event"
import { openUrl } from "@tauri-apps/plugin-opener"
import { create } from "zustand"
import { devtools } from "zustand/middleware"
import { linearCachedIssues, onLinearChanged } from "@/integrations/linear/ipc"
import {
  onAgentDelta,
  onAgentEvent,
  onSessionUpdated,
  onWorkflowRun,
} from "@/lib/events"
import * as ipc from "@/lib/ipc"
import {
  type BackendNotification,
  handleBackendNotification,
  NOTIFY_ACTIVATED,
  NOTIFY_REQUEST,
  notifyFor,
  type ToastPayload,
} from "@/lib/notify"
import { reportError } from "./shared"
import { createGitSlice } from "./slices/git"
import { createGroupsSlice } from "./slices/groups"
import { createLabelsSlice } from "./slices/labels"
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
      ...createLabelsSlice(set, get, store),

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

          // Clicking a toast in the notifications window lands back here.
          void listen<ToastPayload>(NOTIFY_ACTIVATED, ({ payload }) => {
            const target = payload.target
            if (!target) return
            if (target.kind === "session") get().openSession(target.id)
            else if (target.kind === "workflow") get().openWorkflow(target.id)
            else void openUrl(target.url).catch(() => {})
          }).catch(() => {})

          // Backend-originated notifications (e.g. the PR poller).
          void listen<BackendNotification>(NOTIFY_REQUEST, ({ payload }) =>
            handleBackendNotification(payload)
          ).catch(() => {})

          // Re-probe providers when the window regains focus, so installs or
          // logins done outside the app are reflected without a restart.
          window.addEventListener("focus", () => void get().loadProviders())
          // Report focus to the backend; remote pollers tier their cadence
          // (hot while focused, slow in background, crawl when idle).
          window.addEventListener(
            "focus",
            () => void ipc.setAppFocusState(true)
          )
          window.addEventListener(
            "blur",
            () => void ipc.setAppFocusState(false)
          )
          void ipc.setAppFocusState(document.hasFocus())

          // Notify on freshly assigned Linear issues. The baseline seeds from
          // the pre-sync cache, so assignments made while the app was closed
          // notify on launch. An empty cache (first connect, recreated
          // database) leaves the baseline unset, so the first sync adopts its
          // whole set silently instead of announcing every assigned issue.
          let knownLinearIds: Set<string> | null = null
          const seeded = linearCachedIssues()
            .then((issues) => {
              if (issues.length > 0) {
                knownLinearIds = new Set(issues.map((i) => i.id))
              }
            })
            .catch(() => {})
          void onLinearChanged(async () => {
            try {
              // The first change event can race the seed read; the baseline
              // must win or every cached issue would look fresh.
              await seeded
              const issues = await linearCachedIssues()
              const ids = new Set(issues.map((i) => i.id))
              if (knownLinearIds) {
                const fresh = issues.filter(
                  // biome-ignore lint/style/noNonNullAssertion: guarded just above
                  (i) => !knownLinearIds!.has(i.id)
                )
                for (const issue of fresh.slice(0, 3))
                  void notifyFor(
                    "linearAssigned",
                    `Assigned: ${issue.identifier}`,
                    issue.title,
                    { target: { kind: "url", url: issue.url } }
                  )
              }
              knownLinearIds = ids
            } catch {
              // cache reload is best-effort
            }
          })
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
