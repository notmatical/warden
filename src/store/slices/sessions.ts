import type { StateCreator } from "zustand"
import { refreshGitStatus } from "@/hooks/use-git-status"
import * as ipc from "@/lib/ipc"
import {
  backendForModel,
  DEFAULT_CHAT_MODEL,
  DEFAULT_CODEX_MODEL,
} from "@/lib/models"
import { notifyFor, windowFocused } from "@/lib/notify"
import * as terminals from "@/lib/terminal-instances"
import { detachRef, diffTabId, firstLeaf } from "@/lib/viewport"
import { NATIVE_CLI, NATIVE_TITLE, reportError, showRef } from "../shared"
import type { AppState } from "../types"

type SessionsSlice = Pick<
  AppState,
  | "sessions"
  | "createSession"
  | "createNativeSession"
  | "updateSession"
  | "setIsolation"
  | "isolationPending"
  | "renameSession"
  | "deleteSessions"
  | "deleteSession"
  | "setSessionPinned"
  | "onSessionUpdated"
>

/** Session lifecycle: create (agent + native terminal), live settings, rename,
 *  delete, and reconciling backend session-updated events. */
export const createSessionsSlice: StateCreator<
  AppState,
  [],
  [],
  SessionsSlice
> = (set, get) => ({
  sessions: {},

  createSession: async (opts) => {
    if (!opts.projectId) {
      reportError("No folder selected", "Add a folder to this group first.")
      return null
    }
    // The session belongs to the group that owns its root — not whatever group
    // was last focused. An explicit groupId wins (a root can live in several
    // groups); fall back to the active group only if the root isn't found.
    const groupId =
      opts.groupId ??
      Object.entries(get().rootsByGroup).find(([, roots]) =>
        roots.some((root) => root.id === opts.projectId)
      )?.[0] ??
      get().activeGroupId
    if (!groupId) {
      reportError("No group selected", "Create a group first.")
      return null
    }
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
        backend: opts.backend,
        isolate: opts.isolate,
        nativeCommand: opts.nativeCommand,
        workingDir: opts.workingDir,
        linearIssueId: opts.linearIssueId,
      })
      set((state) => ({
        sessions: { ...state.sessions, [session.id]: session },
        sessionsByGroup: {
          ...state.sessionsByGroup,
          [groupId]: [...(state.sessionsByGroup[groupId] ?? []), session.id],
        },
        openTabs: [...state.openTabs, session.id],
        activeTabId: session.id,
        // Show the new session in the focused pane (a fresh viewport places it
        // in the lone empty leaf).
        layout: showRef(state.layout, state.activeTabId, session.id),
        eventsBySession: { ...state.eventsBySession, [session.id]: [] },
      }))
      get().saveView()
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

  createNativeSession: async (projectId, provider) => {
    await get().createSession({
      projectId,
      title: NATIVE_TITLE[provider],
      model: provider === "codex" ? DEFAULT_CODEX_MODEL : DEFAULT_CHAT_MODEL,
      permissionMode: "bypassPermissions",
      role: "chat",
      kind: "terminal",
      backend: provider,
      nativeCommand: NATIVE_CLI[provider],
    })
  },

  updateSession: async (sessionId, patch) => {
    const current = get().sessions[sessionId]
    if (!current) return
    // A model change re-homes the session to that model's backend (gpt → codex);
    // reflect it optimistically so the provider icon/menu update instantly.
    const backend = patch.model ? backendForModel(patch.model) : current.backend
    // Optimistically apply so the controls feel instant; the backend emits the
    // authoritative session-updated event which reconciles.
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: { ...current, ...patch, backend },
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

  isolationPending: {},

  setIsolation: async (sessionId, isolate) => {
    // Provisioning/tearing down a worktree takes a beat — surface it on the
    // status chip instead of leaving the click apparently ignored.
    set((state) => ({
      isolationPending: {
        ...state.isolationPending,
        [sessionId]: isolate ? "worktree" : "checkout",
      },
    }))
    try {
      // The backend re-provisions and emits the authoritative session-updated.
      await ipc.setSessionIsolation(sessionId, isolate)
    } catch (error) {
      reportError("Failed to change isolation", error)
    } finally {
      set((state) => {
        const isolationPending = { ...state.isolationPending }
        delete isolationPending[sessionId]
        return { isolationPending }
      })
      // The chip's branch text comes from the 5s git-status poll; pull it
      // forward so the badge hands off to fresh data, not a stale branch.
      refreshGitStatus(sessionId)
    }
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

    // A deleted session takes its diff tab down with it.
    const closed = new Set<string>()
    for (const sid of deleted) {
      closed.add(sid)
      closed.add(diffTabId(sid))
    }

    set((state) => {
      const omit = <T>(record: Record<string, T>): Record<string, T> =>
        Object.fromEntries(
          Object.entries(record).filter(([sid]) => !deleted.has(sid))
        )

      const sessionsByGroup = Object.fromEntries(
        Object.entries(state.sessionsByGroup).map(([gid, ids]) => [
          gid,
          ids.filter((id) => !deleted.has(id)),
        ])
      )

      const prevTabs = state.openTabs
      const openTabs = prevTabs.filter((sid) => !closed.has(sid))

      let layout = state.layout
      for (const sid of closed) layout = detachRef(layout, sid)

      let activeTabId = state.activeTabId
      if (activeTabId && closed.has(activeTabId)) {
        const idx = prevTabs.indexOf(activeTabId)
        const surviving = (start: number, step: number) => {
          for (let i = start; i >= 0 && i < prevTabs.length; i += step) {
            const sid = prevTabs[i]
            if (!closed.has(sid)) return sid
          }
          return null
        }
        // Prefer a still-visible pane; else the nearest surviving tab.
        activeTabId =
          firstLeaf(layout).ref ??
          surviving(idx + 1, 1) ??
          surviving(idx - 1, -1)
        if (activeTabId) {
          layout = showRef(layout, activeTabId, activeTabId)
        }
      }

      return {
        sessions: omit(state.sessions),
        sessionsByGroup,
        openTabs,
        activeTabId,
        layout,
        eventsBySession: omit(state.eventsBySession),
        approvalResolvedBySession: omit(state.approvalResolvedBySession),
        streamingBySession: omit(state.streamingBySession),
        startedAtBySession: omit(state.startedAtBySession),
        loadingEventsBySession: omit(state.loadingEventsBySession),
      }
    })

    get().saveView()
  },

  deleteSession: (sessionId) => get().deleteSessions([sessionId]),

  setSessionPinned: async (id, pinned) => {
    const prev = get().sessions[id]
    if (!prev) return
    // Optimistic — the backend also emits a session-updated event.
    set((s) => ({ sessions: { ...s.sessions, [id]: { ...prev, pinned } } }))
    try {
      await ipc.setSessionPinned(id, pinned)
    } catch (error) {
      reportError("Failed to pin session", error)
      set((s) => ({
        sessions: {
          ...s.sessions,
          [id]: { ...s.sessions[id], pinned: prev.pinned },
        },
      }))
    }
  },

  onSessionUpdated: (session) => {
    const prev = get().sessions[session.id]
    const finishedTurn =
      prev?.status === "running" && session.status !== "running"
    // CI checks settling (→ success/failure) on an open PR, via the poller.
    const checksSettled =
      prev !== undefined &&
      session.prNumber !== null &&
      prev.prCheckStatus !== session.prCheckStatus &&
      (session.prCheckStatus === "success" ||
        session.prCheckStatus === "failure")
    set((state) => {
      const wasRunning = state.sessions[session.id]?.status === "running"
      const isRunning = session.status === "running"
      let startedAtBySession = state.startedAtBySession
      if (isRunning && !wasRunning) {
        startedAtBySession = {
          ...startedAtBySession,
          [session.id]: Date.now(),
        }
      } else if (!isRunning && wasRunning) {
        startedAtBySession = { ...startedAtBySession }
        delete startedAtBySession[session.id]
      }
      // Keep the sidebar's per-workflow list in sync as the executor spawns
      // new node sessions and emits session-updated for them.
      let sessionsByWorkflow = state.sessionsByWorkflow
      if (session.workflowId) {
        const existing = sessionsByWorkflow[session.workflowId]
        if (existing && !existing.includes(session.id)) {
          sessionsByWorkflow = {
            ...sessionsByWorkflow,
            [session.workflowId]: [...existing, session.id],
          }
        }
      }
      return {
        sessions: { ...state.sessions, [session.id]: session },
        startedAtBySession,
        sessionsByWorkflow,
      }
    })
    // Nudge with a native notification when a turn finishes while you're away.
    if (finishedTurn && !windowFocused()) {
      const errored = session.status === "error"
      void notifyFor(
        "sessionDone",
        errored ? `${session.title} stopped` : `${session.title} finished`,
        errored
          ? "The agent stopped on an error."
          : "The agent is ready for your next message.",
        {
          target: { kind: "session", id: session.id },
          tone: errored ? "error" : "default",
        }
      )
    }
    if (checksSettled && !windowFocused()) {
      const failed = session.prCheckStatus === "failure"
      void notifyFor(
        "prChecks",
        failed
          ? `Checks failed on PR #${session.prNumber}`
          : `Checks passed on PR #${session.prNumber}`,
        session.title,
        {
          target: { kind: "session", id: session.id },
          tone: failed ? "error" : "default",
        }
      )
    }
  },
})
