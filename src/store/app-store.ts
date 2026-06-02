import { open } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import { create } from "zustand"

import * as ipc from "@/lib/ipc"
import { onAgentDelta, onAgentEvent, onSessionUpdated } from "@/lib/events"
import {
  DEFAULT_LAYOUT,
  detachSession,
  parseLayout,
  serializeLayout,
} from "@/lib/layout"
import * as terminals from "@/lib/terminal-instances"
import type {
  DeltaPayload,
  EffortLevel,
  EventRecord,
  Group,
  Layout,
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
const SIDEBAR_WIDTH_KEY = "warden:sidebar-width"
const DEFAULT_SIDEBAR_WIDTH = 256
const MIN_SIDEBAR_WIDTH = 208
const MAX_SIDEBAR_WIDTH = 420

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1"
  } catch {
    return false
  }
}

function clampWidth(px: number): number {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(px)))
}

function readSidebarWidth(): number {
  try {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
    return Number.isFinite(stored) && stored > 0
      ? clampWidth(stored)
      : DEFAULT_SIDEBAR_WIDTH
  } catch {
    return DEFAULT_SIDEBAR_WIDTH
  }
}

export interface CreateSessionOptions {
  projectId: string
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
  groups: Group[]
  activeGroupId: string | null
  /** A group's repo roots, ordered. */
  rootsByGroup: Record<string, Project[]>
  /** All session ids in a group (for the sidebar tree, not just open tabs). */
  sessionsByGroup: Record<string, string[]>
  /** Parsed, editable pane layout per group. */
  layoutByGroup: Record<string, Layout>
  /** Open tabs per group, in order — the group owns its tabs. */
  tabsByGroup: Record<string, string[]>
  /** The active tab per group. */
  activeSessionByGroup: Record<string, string | null>
  sessions: Record<string, Session>
  eventsBySession: Record<string, EventRecord[]>
  streamingBySession: Record<string, string>
  /** Wall-clock start of the in-flight turn, for the live elapsed timer. */
  startedAtBySession: Record<string, number>

  sidebarCollapsed: boolean
  sidebarWidth: number

  initialized: boolean
  loadingGroups: boolean
  loadingEventsBySession: Record<string, boolean>

  init: () => Promise<void>
  setSidebarCollapsed: (collapsed: boolean) => void
  setSidebarWidth: (width: number) => void
  loadGroupData: (groupId: string) => Promise<void>
  createGroup: (name: string) => Promise<Group | null>
  selectGroup: (id: string) => Promise<void>
  renameGroup: (id: string, name: string) => Promise<void>
  deleteGroup: (id: string) => Promise<void>
  addRoot: (groupId: string) => Promise<void>
  removeRoot: (groupId: string, projectId: string) => Promise<void>
  setLayout: (groupId: string, layout: Layout) => void
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
  groups: [],
  activeGroupId: null,
  rootsByGroup: {},
  sessionsByGroup: {},
  layoutByGroup: {},
  tabsByGroup: {},
  activeSessionByGroup: {},
  sessions: {},
  eventsBySession: {},
  streamingBySession: {},
  startedAtBySession: {},

  sidebarCollapsed: readSidebarCollapsed(),
  sidebarWidth: readSidebarWidth(),

  initialized: false,
  loadingGroups: false,
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

    set({ loadingGroups: true })
    try {
      const groups = await ipc.listGroups()
      set({ groups })
      const first = groups[0]
      if (first) {
        set({ activeGroupId: first.id })
        await get().loadGroupData(first.id)
      }
    } catch (error) {
      reportError("Failed to load groups", error)
    } finally {
      set({ loadingGroups: false })
    }
  },

  setSidebarCollapsed: (collapsed) => {
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0")
    } catch {
      // ignore storage failures
    }
    set({ sidebarCollapsed: collapsed })
  },

  setSidebarWidth: (width) => {
    const clamped = clampWidth(width)
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped))
    } catch {
      // ignore storage failures
    }
    set({ sidebarWidth: clamped })
  },

  // Loads a group's roots and sessions into the store for the sidebar tree.
  // Does not change which tabs are open — that's driven by openSession.
  loadGroupData: async (groupId) => {
    try {
      const [roots, sessions] = await Promise.all([
        ipc.listGroupRoots(groupId),
        ipc.listGroupSessions(groupId),
      ])
      set((state) => {
        const nextSessions = { ...state.sessions }
        for (const session of sessions) {
          nextSessions[session.id] = session
        }
        const group = state.groups.find((g) => g.id === groupId)
        const layout = state.layoutByGroup[groupId]
          ? state.layoutByGroup[groupId]
          : parseLayout(group?.layout ?? "")
        return {
          sessions: nextSessions,
          rootsByGroup: { ...state.rootsByGroup, [groupId]: roots },
          sessionsByGroup: {
            ...state.sessionsByGroup,
            [groupId]: sessions.map((s) => s.id),
          },
          layoutByGroup: { ...state.layoutByGroup, [groupId]: layout },
          tabsByGroup: {
            ...state.tabsByGroup,
            [groupId]: state.tabsByGroup[groupId] ?? [],
          },
          activeSessionByGroup: {
            ...state.activeSessionByGroup,
            [groupId]: state.activeSessionByGroup[groupId] ?? null,
          },
        }
      })
    } catch (error) {
      reportError("Failed to load group", error)
    }
  },

  createGroup: async (name) => {
    try {
      const group = await ipc.createGroup(name)
      set((state) => ({
        groups: [...state.groups, group],
        activeGroupId: group.id,
        rootsByGroup: { ...state.rootsByGroup, [group.id]: [] },
        sessionsByGroup: { ...state.sessionsByGroup, [group.id]: [] },
        layoutByGroup: { ...state.layoutByGroup, [group.id]: DEFAULT_LAYOUT },
        tabsByGroup: { ...state.tabsByGroup, [group.id]: [] },
        activeSessionByGroup: {
          ...state.activeSessionByGroup,
          [group.id]: null,
        },
      }))
      return group
    } catch (error) {
      reportError("Failed to create group", error)
      return null
    }
  },

  selectGroup: async (id) => {
    if (get().activeGroupId === id) {
      return
    }
    set({ activeGroupId: id })
    if (!get().rootsByGroup[id]) {
      await get().loadGroupData(id)
    }
  },

  renameGroup: async (id, name) => {
    const trimmed = name.trim()
    const current = get().groups.find((g) => g.id === id)
    if (!current || !trimmed || trimmed === current.name) return
    set((state) => ({
      groups: state.groups.map((g) =>
        g.id === id ? { ...g, name: trimmed } : g
      ),
    }))
    try {
      await ipc.renameGroup(id, trimmed)
    } catch (error) {
      set((state) => ({
        groups: state.groups.map((g) => (g.id === id ? current : g)),
      }))
      reportError("Failed to rename group", error)
    }
  },

  deleteGroup: async (id) => {
    const { groups, sessionsByGroup, sessions } = get()
    const ownedSessions = sessionsByGroup[id] ?? []
    for (const sid of ownedSessions) {
      if (sessions[sid]?.kind === "terminal") {
        terminals.dispose(sid)
      }
    }
    set((state) => {
      const nextGroups = state.groups.filter((g) => g.id !== id)
      let activeGroupId = state.activeGroupId
      if (activeGroupId === id) {
        activeGroupId = nextGroups[0]?.id ?? null
      }
      const omit = <T,>(record: Record<string, T>): Record<string, T> =>
        Object.fromEntries(
          Object.entries(record).filter(([gid]) => gid !== id)
        )
      return {
        groups: nextGroups,
        activeGroupId,
        rootsByGroup: omit(state.rootsByGroup),
        sessionsByGroup: omit(state.sessionsByGroup),
        layoutByGroup: omit(state.layoutByGroup),
        tabsByGroup: omit(state.tabsByGroup),
        activeSessionByGroup: omit(state.activeSessionByGroup),
      }
    })
    try {
      await ipc.deleteGroup(id)
    } catch (error) {
      reportError("Failed to delete group", error)
      set({ groups })
    }
  },

  addRoot: async (groupId) => {
    try {
      const selected = await open({ directory: true, multiple: false })
      if (typeof selected !== "string") {
        return
      }
      const project = await ipc.addGroupRoot(groupId, selected)
      set((state) => {
        const roots = state.rootsByGroup[groupId] ?? []
        return {
          rootsByGroup: {
            ...state.rootsByGroup,
            [groupId]: roots.some((p) => p.id === project.id)
              ? roots.map((p) => (p.id === project.id ? project : p))
              : [...roots, project],
          },
        }
      })
    } catch (error) {
      reportError("Failed to add folder", error)
    }
  },

  removeRoot: async (groupId, projectId) => {
    try {
      await ipc.removeGroupRoot(groupId, projectId)
      set((state) => ({
        rootsByGroup: {
          ...state.rootsByGroup,
          [groupId]: (state.rootsByGroup[groupId] ?? []).filter(
            (p) => p.id !== projectId
          ),
        },
      }))
    } catch (error) {
      reportError("Failed to remove folder", error)
    }
  },

  setLayout: (groupId, layout) => {
    set((state) => ({
      layoutByGroup: { ...state.layoutByGroup, [groupId]: layout },
    }))
    void ipc
      .setGroupLayout(groupId, serializeLayout(layout))
      .catch((error) => reportError("Failed to save layout", error))
  },

  createSession: async (opts) => {
    const groupId = get().activeGroupId
    if (!groupId) {
      reportError("No group selected", "Create a group first.")
      return null
    }
    if (!opts.projectId) {
      reportError("No folder selected", "Add a folder to this group first.")
      return null
    }
    const wasEmpty = (get().tabsByGroup[groupId]?.length ?? 0) === 0
    try {
      const session = await ipc.createSession({
        projectId: opts.projectId,
        groupId,
        title: opts.title,
        model: opts.model,
        permissionMode: opts.permissionMode,
        effort: opts.effort,
        role: opts.role,
        kind: opts.kind,
        isolate: opts.isolate,
      })
      if (wasEmpty) {
        get().setLayout(groupId, DEFAULT_LAYOUT)
      }
      set((state) => ({
        sessions: { ...state.sessions, [session.id]: session },
        sessionsByGroup: {
          ...state.sessionsByGroup,
          [groupId]: [
            ...(state.sessionsByGroup[groupId] ?? []),
            session.id,
          ],
        },
        tabsByGroup: {
          ...state.tabsByGroup,
          [groupId]: [...(state.tabsByGroup[groupId] ?? []), session.id],
        },
        activeSessionByGroup: {
          ...state.activeSessionByGroup,
          [groupId]: session.id,
        },
        eventsBySession: { ...state.eventsBySession, [session.id]: [] },
      }))
      if (
        opts.kind !== "terminal" &&
        opts.firstMessage &&
        opts.firstMessage.trim()
      ) {
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
    const session = get().sessions[id]
    if (!session) {
      return
    }
    const groupId = session.groupId
    // Opening into an empty workspace shows the session full-screen; a
    // multi-pane layout is something the user opts into explicitly.
    const wasEmpty = (get().tabsByGroup[groupId]?.length ?? 0) === 0
    set((state) => {
      const tabs = state.tabsByGroup[groupId] ?? []
      return {
        activeGroupId: groupId,
        tabsByGroup: {
          ...state.tabsByGroup,
          [groupId]: tabs.includes(id) ? tabs : [...tabs, id],
        },
        activeSessionByGroup: {
          ...state.activeSessionByGroup,
          [groupId]: id,
        },
      }
    })
    if (wasEmpty) {
      get().setLayout(groupId, DEFAULT_LAYOUT)
    }
    if (!get().eventsBySession[id]) {
      void get().loadEvents(id)
    }
  },

  selectSession: (id) => {
    const groupId = get().activeGroupId
    if (!groupId || !get().sessions[id]) {
      return
    }
    set((state) => ({
      activeSessionByGroup: { ...state.activeSessionByGroup, [groupId]: id },
    }))
    if (!get().eventsBySession[id]) {
      void get().loadEvents(id)
    }
  },

  closeTab: (id) => {
    const groupId = get().activeGroupId
    if (!groupId) return
    // Closing a terminal tab kills its PTY (no orphan processes); the session
    // row survives in the sidebar and reopens to a resume prompt.
    if (get().sessions[id]?.kind === "terminal") {
      terminals.dispose(id)
    }
    let detached: Layout | null = null
    set((state) => {
      const prevTabs = state.tabsByGroup[groupId] ?? []
      const tabs = prevTabs.filter((sid) => sid !== id)
      let active = state.activeSessionByGroup[groupId] ?? null
      if (active === id) {
        const closedIndex = prevTabs.indexOf(id)
        active =
          tabs[closedIndex] ?? tabs[closedIndex - 1] ?? tabs[0] ?? null
      }
      const layout = state.layoutByGroup[groupId]
      if (layout && layout.panes.includes(id)) {
        detached = detachSession(layout, id)
      }
      return {
        tabsByGroup: { ...state.tabsByGroup, [groupId]: tabs },
        activeSessionByGroup: {
          ...state.activeSessionByGroup,
          [groupId]: active,
        },
      }
    })
    if (detached) {
      get().setLayout(groupId, detached)
    }
  },

  closeOthers: (id) => {
    const groupId = get().activeGroupId
    if (!groupId) return
    const { tabsByGroup, sessions } = get()
    const tabs = tabsByGroup[groupId] ?? []
    if (!tabs.includes(id)) return
    for (const sid of tabs) {
      if (sid !== id && sessions[sid]?.kind === "terminal") {
        terminals.dispose(sid)
      }
    }
    set((state) => ({
      tabsByGroup: { ...state.tabsByGroup, [groupId]: [id] },
      activeSessionByGroup: { ...state.activeSessionByGroup, [groupId]: id },
    }))
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
      const omit = <T,>(record: Record<string, T>): Record<string, T> =>
        Object.fromEntries(
          Object.entries(record).filter(([sid]) => !deleted.has(sid))
        )

      const sessionsByGroup = Object.fromEntries(
        Object.entries(state.sessionsByGroup).map(([gid, ids]) => [
          gid,
          ids.filter((id) => !deleted.has(id)),
        ])
      )

      const tabsByGroup: Record<string, string[]> = {}
      const activeSessionByGroup: Record<string, string | null> = {}
      const layoutByGroup = { ...state.layoutByGroup }

      for (const [gid, prevTabs] of Object.entries(state.tabsByGroup)) {
        const tabs = prevTabs.filter((sid) => !deleted.has(sid))
        tabsByGroup[gid] = tabs

        let active = state.activeSessionByGroup[gid] ?? null
        if (active && deleted.has(active)) {
          const idx = prevTabs.indexOf(active)
          const surviving = (start: number, step: number) => {
            for (let i = start; i >= 0 && i < prevTabs.length; i += step) {
              const sid = prevTabs[i]
              if (!deleted.has(sid)) return sid
            }
            return null
          }
          active = surviving(idx + 1, 1) ?? surviving(idx - 1, -1)
        }
        activeSessionByGroup[gid] = active

        const layout = state.layoutByGroup[gid]
        if (layout) {
          let next = layout
          for (const sid of deleted) {
            next = detachSession(next, sid)
          }
          if (next !== layout) {
            layoutByGroup[gid] = next
            void ipc
              .setGroupLayout(gid, serializeLayout(next))
              .catch((error) => reportError("Failed to save layout", error))
          }
        }
      }

      return {
        sessions: omit(state.sessions),
        sessionsByGroup,
        tabsByGroup,
        activeSessionByGroup,
        layoutByGroup,
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
    const groupId = get().activeGroupId
    if (!groupId) {
      reportError("No group selected", "Create a group first.")
      return
    }
    const projectId = get().rootsByGroup[groupId]?.[0]?.id
    if (!projectId) {
      reportError("No folder in this group", "Add a folder first.")
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
        const groupSessions = [
          ...(state.sessionsByGroup[groupId] ?? []),
          result.planner.id,
          result.coder.id,
        ]
        const tabs = [...(state.tabsByGroup[groupId] ?? [])]
        for (const id of [result.planner.id, result.coder.id]) {
          if (!tabs.includes(id)) {
            tabs.push(id)
          }
        }
        return {
          sessions,
          sessionsByGroup: {
            ...state.sessionsByGroup,
            [groupId]: groupSessions,
          },
          tabsByGroup: { ...state.tabsByGroup, [groupId]: tabs },
          activeSessionByGroup: {
            ...state.activeSessionByGroup,
            [groupId]: result.coder.id,
          },
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
