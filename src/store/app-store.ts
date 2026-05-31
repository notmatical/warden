import { open } from "@tauri-apps/plugin-dialog"
import { create } from "zustand"

import * as ipc from "@/lib/ipc"
import { onAgentDelta, onAgentEvent, onSessionUpdated } from "@/lib/events"
import type {
  DeltaPayload,
  EventRecord,
  PermissionMode,
  Session,
  SessionRole,
  Workspace,
} from "@/types"

function reportError(scope: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  // Lazy import to avoid a hard dependency cycle with the toaster.
  import("sonner").then(({ toast }) => {
    toast.error(scope, { description: message })
  })
}

export interface CreateSessionOptions {
  title: string
  model: string
  permissionMode: PermissionMode
  role?: SessionRole
  firstMessage?: string
}

export interface RunPlanToCodeOptions {
  task: string
  plannerModel: string
  coderModel: string
}

interface AppState {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  sessions: Record<string, Session>
  sessionOrder: string[]
  activeSessionId: string | null
  eventsBySession: Record<string, EventRecord[]>
  streamingBySession: Record<string, string>

  initialized: boolean
  loadingWorkspaces: boolean
  loadingSessions: boolean
  loadingEventsBySession: Record<string, boolean>

  init: () => Promise<void>
  openWorkspace: () => Promise<void>
  selectWorkspace: (id: string) => Promise<void>
  loadSessions: (workspaceId: string) => Promise<void>
  createSession: (opts: CreateSessionOptions) => Promise<Session | null>
  selectSession: (id: string) => void
  closeTab: (id: string) => void
  sendMessage: (sessionId: string, text: string) => Promise<void>
  cancel: (sessionId: string) => Promise<void>
  runPlanToCode: (opts: RunPlanToCodeOptions) => Promise<void>
  loadEvents: (sessionId: string) => Promise<void>

  onAgentEvent: (record: EventRecord) => void
  onDelta: (payload: DeltaPayload) => void
  onSessionUpdated: (session: Session) => void
}

let listenersWired = false

export const useAppStore = create<AppState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  sessions: {},
  sessionOrder: [],
  activeSessionId: null,
  eventsBySession: {},
  streamingBySession: {},

  initialized: false,
  loadingWorkspaces: false,
  loadingSessions: false,
  loadingEventsBySession: {},

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
    }

    set({ loadingWorkspaces: true })
    try {
      const workspaces = await ipc.listWorkspaces()
      set({ workspaces })
      const first = workspaces[0]
      if (first) {
        set({ activeWorkspaceId: first.id })
        await get().loadSessions(first.id)
      }
    } catch (error) {
      reportError("Failed to load workspaces", error)
    } finally {
      set({ loadingWorkspaces: false })
    }
  },

  openWorkspace: async () => {
    try {
      const selected = await open({ directory: true, multiple: false })
      if (typeof selected !== "string") {
        return
      }
      const workspace = await ipc.openWorkspace(selected)
      set((state) => {
        const exists = state.workspaces.some((w) => w.id === workspace.id)
        return {
          workspaces: exists
            ? state.workspaces.map((w) =>
                w.id === workspace.id ? workspace : w
              )
            : [...state.workspaces, workspace],
          activeWorkspaceId: workspace.id,
        }
      })
      await get().loadSessions(workspace.id)
    } catch (error) {
      reportError("Failed to open workspace", error)
    }
  },

  selectWorkspace: async (id) => {
    if (get().activeWorkspaceId === id) {
      return
    }
    set({ activeWorkspaceId: id })
    await get().loadSessions(id)
  },

  loadSessions: async (workspaceId) => {
    set({ loadingSessions: true })
    try {
      const sessions = await ipc.listSessions(workspaceId)
      set((state) => {
        const nextSessions = { ...state.sessions }
        for (const session of sessions) {
          nextSessions[session.id] = session
        }
        const order = sessions.map((s) => s.id)
        const activeStillPresent =
          state.activeSessionId !== null &&
          order.includes(state.activeSessionId)
        return {
          sessions: nextSessions,
          sessionOrder: order,
          activeSessionId: activeStillPresent
            ? state.activeSessionId
            : (order[0] ?? null),
        }
      })
      const active = get().activeSessionId
      if (active && !get().eventsBySession[active]) {
        await get().loadEvents(active)
      }
    } catch (error) {
      reportError("Failed to load sessions", error)
    } finally {
      set({ loadingSessions: false })
    }
  },

  createSession: async (opts) => {
    const workspaceId = get().activeWorkspaceId
    if (!workspaceId) {
      reportError("No workspace selected", "Open a folder first.")
      return null
    }
    try {
      const session = await ipc.createSession({
        workspaceId,
        title: opts.title,
        model: opts.model,
        permissionMode: opts.permissionMode,
        role: opts.role,
      })
      set((state) => ({
        sessions: { ...state.sessions, [session.id]: session },
        sessionOrder: state.sessionOrder.includes(session.id)
          ? state.sessionOrder
          : [...state.sessionOrder, session.id],
        activeSessionId: session.id,
        eventsBySession: { ...state.eventsBySession, [session.id]: [] },
      }))
      if (opts.firstMessage && opts.firstMessage.trim()) {
        await get().sendMessage(session.id, opts.firstMessage.trim())
      }
      return session
    } catch (error) {
      reportError("Failed to create session", error)
      return null
    }
  },

  selectSession: (id) => {
    if (!get().sessions[id]) {
      return
    }
    set({ activeSessionId: id })
    if (!get().eventsBySession[id]) {
      void get().loadEvents(id)
    }
  },

  closeTab: (id) => {
    set((state) => {
      const order = state.sessionOrder.filter((sid) => sid !== id)
      let activeSessionId = state.activeSessionId
      if (activeSessionId === id) {
        const closedIndex = state.sessionOrder.indexOf(id)
        activeSessionId =
          order[closedIndex] ?? order[closedIndex - 1] ?? order[0] ?? null
      }
      return { sessionOrder: order, activeSessionId }
    })
  },

  sendMessage: async (sessionId, text) => {
    try {
      await ipc.sendMessage(sessionId, text)
    } catch (error) {
      reportError("Failed to send message", error)
    }
  },

  cancel: async (sessionId) => {
    try {
      await ipc.cancelSession(sessionId)
    } catch (error) {
      reportError("Failed to cancel session", error)
    }
  },

  runPlanToCode: async (opts) => {
    const workspaceId = get().activeWorkspaceId
    if (!workspaceId) {
      reportError("No workspace selected", "Open a folder first.")
      return
    }
    try {
      const result = await ipc.runPlanToCode({
        workspaceId,
        task: opts.task,
        plannerModel: opts.plannerModel,
        coderModel: opts.coderModel,
      })
      set((state) => {
        const sessions = { ...state.sessions }
        sessions[result.planner.id] = result.planner
        sessions[result.coder.id] = result.coder
        const order = [...state.sessionOrder]
        for (const id of [result.planner.id, result.coder.id]) {
          if (!order.includes(id)) {
            order.push(id)
          }
        }
        return {
          sessions,
          sessionOrder: order,
          activeSessionId: result.coder.id,
          eventsBySession: {
            ...state.eventsBySession,
            [result.planner.id]: state.eventsBySession[result.planner.id] ?? [],
            [result.coder.id]: state.eventsBySession[result.coder.id] ?? [],
          },
        }
      })
      void get().loadEvents(result.planner.id)
      void get().loadEvents(result.coder.id)
    } catch (error) {
      reportError("Failed to run plan to code", error)
    }
  },

  loadEvents: async (sessionId) => {
    set((state) => ({
      loadingEventsBySession: {
        ...state.loadingEventsBySession,
        [sessionId]: true,
      },
    }))
    try {
      const events = await ipc.getEvents(sessionId)
      set((state) => ({
        eventsBySession: { ...state.eventsBySession, [sessionId]: events },
      }))
    } catch (error) {
      reportError("Failed to load events", error)
    } finally {
      set((state) => ({
        loadingEventsBySession: {
          ...state.loadingEventsBySession,
          [sessionId]: false,
        },
      }))
    }
  },

  onAgentEvent: (record) => {
    set((state) => {
      const existing = state.eventsBySession[record.sessionId] ?? []
      if (existing.some((e) => e.id === record.id)) {
        return state
      }

      const eventsBySession = {
        ...state.eventsBySession,
        [record.sessionId]: [...existing, record],
      }

      let streamingBySession = state.streamingBySession
      if (record.type === "assistant_text" || record.type === "result") {
        if (state.streamingBySession[record.sessionId]) {
          streamingBySession = { ...state.streamingBySession }
          delete streamingBySession[record.sessionId]
        }
      }

      let sessions = state.sessions
      if (record.type === "result") {
        const session = state.sessions[record.sessionId]
        if (session) {
          sessions = {
            ...state.sessions,
            [record.sessionId]: {
              ...session,
              costUsd:
                record.cost_usd !== null ? record.cost_usd : session.costUsd,
              turns:
                record.num_turns !== null ? record.num_turns : session.turns,
            },
          }
        }
      }

      return { eventsBySession, streamingBySession, sessions }
    })
  },

  onDelta: ({ sessionId, text }) => {
    set((state) => ({
      streamingBySession: {
        ...state.streamingBySession,
        [sessionId]: (state.streamingBySession[sessionId] ?? "") + text,
      },
    }))
  },

  onSessionUpdated: (session) => {
    set((state) => ({
      sessions: { ...state.sessions, [session.id]: session },
    }))
  },
}))
