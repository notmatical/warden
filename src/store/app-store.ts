import { open } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import { create } from "zustand"

import * as ipc from "@/lib/ipc"
import { onAgentDelta, onAgentEvent, onSessionUpdated } from "@/lib/events"
import * as terminals from "@/lib/terminal-instances"
import type {
  DeltaPayload,
  EffortLevel,
  EventRecord,
  PermissionMode,
  Session,
  SessionKind,
  SessionRole,
  Project,
} from "@/types"

function reportError(scope: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  toast.error(scope, { description: message })
}

const SIDEBAR_KEY = "warden:sidebar-collapsed"

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1"
  } catch {
    return false
  }
}

export interface CreateSessionOptions {
  title: string
  model: string
  permissionMode: PermissionMode
  effort?: EffortLevel
  role?: SessionRole
  kind?: SessionKind
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
  projects: Project[]
  activeProjectId: string | null
  sessions: Record<string, Session>
  /** Session ids per project, for the sidebar tree (all sessions, not just open). */
  sessionsByProject: Record<string, string[]>
  /** Open tabs, in order — a subset of sessions the user has opened. */
  sessionOrder: string[]
  activeSessionId: string | null
  eventsBySession: Record<string, EventRecord[]>
  streamingBySession: Record<string, string>
  /** Wall-clock start of the in-flight turn, for the live elapsed timer. */
  startedAtBySession: Record<string, number>

  sidebarCollapsed: boolean

  initialized: boolean
  loadingProjects: boolean
  loadingSessions: boolean
  loadingEventsBySession: Record<string, boolean>

  init: () => Promise<void>
  toggleSidebar: () => void
  openProject: () => Promise<void>
  selectProject: (id: string) => Promise<void>
  loadSessions: (projectId: string) => Promise<void>
  createSession: (opts: CreateSessionOptions) => Promise<Session | null>
  openSession: (id: string) => void
  updateSession: (sessionId: string, patch: SessionSettingsPatch) => Promise<void>
  setIsolation: (sessionId: string, isolate: boolean) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<void>
  deleteSessions: (sessionIds: string[]) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  selectSession: (id: string) => void
  closeTab: (id: string) => void
  closeOthers: (id: string) => void
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
  projects: [],
  activeProjectId: null,
  sessions: {},
  sessionsByProject: {},
  sessionOrder: [],
  activeSessionId: null,
  eventsBySession: {},
  streamingBySession: {},
  startedAtBySession: {},

  sidebarCollapsed: readSidebarCollapsed(),

  initialized: false,
  loadingProjects: false,
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

    set({ loadingProjects: true })
    try {
      const projects = await ipc.listProjects()
      set({ projects })
      const first = projects[0]
      if (first) {
        set({ activeProjectId: first.id })
        await get().loadSessions(first.id)
      }
    } catch (error) {
      reportError("Failed to load projects", error)
    } finally {
      set({ loadingProjects: false })
    }
  },

  toggleSidebar: () => {
    set((state) => {
      const sidebarCollapsed = !state.sidebarCollapsed
      try {
        localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? "1" : "0")
      } catch {
        // ignore storage failures
      }
      return { sidebarCollapsed }
    })
  },

  openProject: async () => {
    try {
      const selected = await open({ directory: true, multiple: false })
      if (typeof selected !== "string") {
        return
      }
      const project = await ipc.openProject(selected)
      set((state) => {
        const exists = state.projects.some((w) => w.id === project.id)
        return {
          projects: exists
            ? state.projects.map((w) =>
                w.id === project.id ? project : w
              )
            : [...state.projects, project],
          activeProjectId: project.id,
        }
      })
      await get().loadSessions(project.id)
    } catch (error) {
      reportError("Failed to open project", error)
    }
  },

  selectProject: async (id) => {
    if (get().activeProjectId === id) {
      return
    }
    set({ activeProjectId: id })
    await get().loadSessions(id)
  },

  // Loads a project's sessions into the store for the sidebar tree. Does not
  // change which tabs are open — that's driven by openSession.
  loadSessions: async (projectId) => {
    set({ loadingSessions: true })
    try {
      const sessions = await ipc.listSessions(projectId)
      set((state) => {
        const nextSessions = { ...state.sessions }
        for (const session of sessions) {
          nextSessions[session.id] = session
        }
        return {
          sessions: nextSessions,
          sessionsByProject: {
            ...state.sessionsByProject,
            [projectId]: sessions.map((s) => s.id),
          },
        }
      })
    } catch (error) {
      reportError("Failed to load sessions", error)
    } finally {
      set({ loadingSessions: false })
    }
  },

  createSession: async (opts) => {
    const projectId = get().activeProjectId
    if (!projectId) {
      reportError("No project selected", "Open a folder first.")
      return null
    }
    try {
      const session = await ipc.createSession({
        projectId,
        title: opts.title,
        model: opts.model,
        permissionMode: opts.permissionMode,
        effort: opts.effort,
        role: opts.role,
        kind: opts.kind,
        isolate: opts.isolate,
      })
      set((state) => ({
        sessions: { ...state.sessions, [session.id]: session },
        sessionsByProject: {
          ...state.sessionsByProject,
          [projectId]: [
            ...(state.sessionsByProject[projectId] ?? []),
            session.id,
          ],
        },
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

  setIsolation: async (sessionId, isolate) => {
    try {
      // The backend re-provisions and emits the authoritative session-updated.
      await ipc.setSessionIsolation(sessionId, isolate)
    } catch (error) {
      reportError("Failed to change isolation", error)
    }
  },

  // Open a session into a tab (from the sidebar) and focus it.
  openSession: (id) => {
    if (!get().sessions[id]) {
      return
    }
    set((state) => ({
      sessionOrder: state.sessionOrder.includes(id)
        ? state.sessionOrder
        : [...state.sessionOrder, id],
      activeSessionId: id,
    }))
    if (!get().eventsBySession[id]) {
      void get().loadEvents(id)
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
    // Closing a terminal tab kills its PTY (no orphan processes); the session
    // row survives in the sidebar and reopens fresh.
    if (get().sessions[id]?.kind === "terminal") {
      terminals.dispose(id)
    }
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

  closeOthers: (id) => {
    const { sessionOrder, sessions } = get()
    if (!sessionOrder.includes(id)) return
    for (const sid of sessionOrder) {
      if (sid !== id && sessions[sid]?.kind === "terminal") {
        terminals.dispose(sid)
      }
    }
    set({ sessionOrder: [id], activeSessionId: id })
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
        if (get().sessions[id]?.kind === "terminal") {
          terminals.dispose(id)
        }
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

      const sessionsByProject = Object.fromEntries(
        Object.entries(state.sessionsByProject).map(([pid, ids]) => [
          pid,
          ids.filter((id) => !deleted.has(id)),
        ])
      )

      return {
        sessionOrder: order,
        activeSessionId,
        sessions: omit(state.sessions),
        sessionsByProject,
        eventsBySession: omit(state.eventsBySession),
        streamingBySession: omit(state.streamingBySession),
        startedAtBySession: omit(state.startedAtBySession),
        loadingEventsBySession: omit(state.loadingEventsBySession),
      }
    })
  },

  deleteSession: (sessionId) => get().deleteSessions([sessionId]),

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
    const projectId = get().activeProjectId
    if (!projectId) {
      reportError("No project selected", "Open a folder first.")
      return
    }
    try {
      const result = await ipc.runPlanToCode({
        projectId,
        task: opts.task,
        plannerModel: opts.plannerModel,
        coderModel: opts.coderModel,
      })
      set((state) => {
        const sessions = { ...state.sessions }
        sessions[result.planner.id] = result.planner
        sessions[result.coder.id] = result.coder
        const projectSessions = [
          ...(state.sessionsByProject[projectId] ?? []),
          result.planner.id,
          result.coder.id,
        ]
        const order = [...state.sessionOrder]
        for (const id of [result.planner.id, result.coder.id]) {
          if (!order.includes(id)) {
            order.push(id)
          }
        }
        return {
          sessions,
          sessionsByProject: {
            ...state.sessionsByProject,
            [projectId]: projectSessions,
          },
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
