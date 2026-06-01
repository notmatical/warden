import { open } from "@tauri-apps/plugin-dialog"
import { create } from "zustand"

import * as ipc from "@/lib/ipc"
import { onAgentDelta, onAgentEvent, onSessionUpdated } from "@/lib/events"
import type {
  DeltaPayload,
  EffortLevel,
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
  effort?: EffortLevel
  role?: SessionRole
  isolate?: boolean
  firstMessage?: string
}

export interface SessionSettingsPatch {
  model?: string
  permissionMode?: PermissionMode
  effort?: EffortLevel
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
  /** Wall-clock start of the in-flight turn, for the live elapsed timer. */
  startedAtBySession: Record<string, number>

  initialized: boolean
  loadingWorkspaces: boolean
  loadingSessions: boolean
  loadingEventsBySession: Record<string, boolean>

  init: () => Promise<void>
  openWorkspace: () => Promise<void>
  selectWorkspace: (id: string) => Promise<void>
  loadSessions: (workspaceId: string) => Promise<void>
  createSession: (opts: CreateSessionOptions) => Promise<Session | null>
  updateSession: (sessionId: string, patch: SessionSettingsPatch) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<void>
  deleteSessions: (sessionIds: string[]) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  deleteOthers: (sessionId: string) => Promise<void>
  deleteToRight: (sessionId: string) => Promise<void>
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
  startedAtBySession: {},

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
        effort: opts.effort,
        role: opts.role,
        isolate: opts.isolate,
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

  updateSession: async (sessionId, patch) => {
    const current = get().sessions[sessionId]
    if (!current) return
    // Optimistically apply so the controls feel instant; the backend emits the
    // authoritative session-updated event which reconciles.
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: { ...current, ...patch },
      },
    }))
    try {
      await ipc.updateSession(sessionId, patch)
    } catch (error) {
      set((state) => ({
        sessions: { ...state.sessions, [sessionId]: current },
      }))
      reportError("Failed to update session", error)
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

  renameSession: async (sessionId, title) => {
    const trimmed = title.trim()
    const current = get().sessions[sessionId]
    if (!current || !trimmed || trimmed === current.title) return
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: { ...current, title: trimmed },
      },
    }))
    try {
      await ipc.renameSession(sessionId, trimmed)
    } catch (error) {
      set((state) => ({
        sessions: { ...state.sessions, [sessionId]: current },
      }))
      reportError("Failed to rename session", error)
    }
  },

  deleteSessions: async (sessionIds) => {
    const deleted = new Set<string>()
    for (const id of sessionIds) {
      try {
        await ipc.deleteSession(id)
        deleted.add(id)
      } catch (error) {
        reportError("Failed to delete session", error)
      }
    }
    if (deleted.size === 0) return

    set((state) => {
      const order = state.sessionOrder.filter((sid) => !deleted.has(sid))

      let activeSessionId = state.activeSessionId
      if (activeSessionId && deleted.has(activeSessionId)) {
        const idx = state.sessionOrder.indexOf(activeSessionId)
        const surviving = (start: number, step: number) => {
          for (let i = start; i >= 0 && i < state.sessionOrder.length; i += step) {
            const sid = state.sessionOrder[i]
            if (!deleted.has(sid)) return sid
          }
          return null
        }
        activeSessionId = surviving(idx + 1, 1) ?? surviving(idx - 1, -1)
      }

      const omit = <T,>(record: Record<string, T>): Record<string, T> =>
        Object.fromEntries(
          Object.entries(record).filter(([sid]) => !deleted.has(sid))
        )

      return {
        sessionOrder: order,
        activeSessionId,
        sessions: omit(state.sessions),
        eventsBySession: omit(state.eventsBySession),
        streamingBySession: omit(state.streamingBySession),
        startedAtBySession: omit(state.startedAtBySession),
        loadingEventsBySession: omit(state.loadingEventsBySession),
      }
    })
  },

  deleteSession: (sessionId) => get().deleteSessions([sessionId]),

  deleteOthers: (sessionId) =>
    get().deleteSessions(
      get().sessionOrder.filter((sid) => sid !== sessionId)
    ),

  deleteToRight: (sessionId) => {
    const order = get().sessionOrder
    const idx = order.indexOf(sessionId)
    return get().deleteSessions(idx >= 0 ? order.slice(idx + 1) : [])
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
    set((state) => {
      const wasRunning = state.sessions[session.id]?.status === "running"
      const isRunning = session.status === "running"
      let startedAtBySession = state.startedAtBySession
      if (isRunning && !wasRunning) {
        startedAtBySession = { ...startedAtBySession, [session.id]: Date.now() }
      } else if (!isRunning && wasRunning) {
        startedAtBySession = { ...startedAtBySession }
        delete startedAtBySession[session.id]
      }
      return {
        sessions: { ...state.sessions, [session.id]: session },
        startedAtBySession,
      }
    })
  },
}))
