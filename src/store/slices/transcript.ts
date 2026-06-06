import type { StateCreator } from "zustand"

import * as ipc from "@/lib/ipc"
import { reportError, showSession } from "../shared"
import type { AppState } from "../types"

type TranscriptSlice = Pick<
  AppState,
  | "eventsBySession"
  | "approvalResolvedBySession"
  | "streamingBySession"
  | "startedAtBySession"
  | "loadingEventsBySession"
  | "sendMessage"
  | "cancel"
  | "approveTools"
  | "approvePlan"
  | "resolveApproval"
  | "runPlanToCode"
  | "loadEvents"
  | "onAgentEvent"
  | "onDelta"
>

/** Per-session transcript: events, live streaming text, turn timers, and the
 *  messaging/approval actions that drive a turn. */
export const createTranscriptSlice: StateCreator<
  AppState,
  [],
  [],
  TranscriptSlice
> = (set, get) => ({
  eventsBySession: {},
  approvalResolvedBySession: {},
  streamingBySession: {},
  startedAtBySession: {},
  loadingEventsBySession: {},

  sendMessage: async (sessionId, text, attachments) => {
    try {
      await ipc.sendMessage(sessionId, text, attachments)
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

  approveTools: async (sessionId, patterns) => {
    try {
      await ipc.approveTools(sessionId, patterns)
    } catch (error) {
      reportError("Failed to approve tools", error)
    }
  },

  approvePlan: async (sessionId) => {
    // Optimistically leave plan mode so the composer's mode chip updates
    // instantly; the backend emits the authoritative session-updated.
    const current = get().sessions[sessionId]
    if (current && current.permissionMode === "plan") {
      set((state) => ({
        sessions: {
          ...state.sessions,
          [sessionId]: { ...current, permissionMode: "acceptEdits" },
        },
      }))
    }
    try {
      await ipc.approvePlan(sessionId)
    } catch (error) {
      if (current) {
        set((state) => ({
          sessions: { ...state.sessions, [sessionId]: current },
        }))
      }
      reportError("Failed to approve plan", error)
    }
  },

  resolveApproval: (sessionId, eventId) => {
    set((state) => ({
      approvalResolvedBySession: {
        ...state.approvalResolvedBySession,
        [sessionId]: eventId,
      },
    }))
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
        const tabs = [...state.openTabs]
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
          openTabs: tabs,
          activeSessionId: result.coder.id,
          layout: showSession(
            state.layout,
            state.activeSessionId,
            result.coder.id
          ),
          eventsBySession: {
            ...state.eventsBySession,
            [result.planner.id]: state.eventsBySession[result.planner.id] ?? [],
            [result.coder.id]: state.eventsBySession[result.coder.id] ?? [],
          },
        }
      })
      get().saveView()
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
})
