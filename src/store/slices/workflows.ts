import { toast } from "sonner"
import type { StateCreator } from "zustand"

import * as ipc from "@/lib/ipc"
import { notify, windowFocused } from "@/lib/notify"
import { workflowTabId } from "@/lib/tab-ref"
import type { WorkflowRunView } from "@/types/workflow"

import { reportError } from "../shared"
import type { AppState } from "../types"

type WorkflowsSlice = Pick<
  AppState,
  | "workflows"
  | "workflowRun"
  | "sessionsByWorkflow"
  | "workflowRunStatusById"
  | "loadWorkflows"
  | "loadWorkflowSessions"
  | "ensureWorkflow"
  | "createWorkflow"
  | "saveWorkflowGraph"
  | "renameWorkflow"
  | "duplicateWorkflow"
  | "deleteWorkflow"
  | "openWorkflow"
  | "runWorkflowById"
  | "resumeRun"
  | "loadWorkflowRun"
  | "applyWorkflowRun"
>

export const createWorkflowsSlice: StateCreator<
  AppState,
  [],
  [],
  WorkflowsSlice
> = (set, get) => ({
  workflows: {},
  workflowRun: null,
  sessionsByWorkflow: {},
  workflowRunStatusById: {},

  loadWorkflows: async (projectId) => {
    try {
      const list = await ipc.listWorkflows(projectId)
      // Merge — several groups/projects populate this for the sidebar.
      set((s) => ({
        workflows: {
          ...s.workflows,
          ...Object.fromEntries(list.map((w) => [w.id, w])),
        },
      }))
    } catch (error) {
      reportError("Failed to load workflows", error)
    }
  },

  loadWorkflowSessions: async (workflowId) => {
    try {
      const list = await ipc.listWorkflowSessions(workflowId)
      set((s) => ({
        sessions: {
          ...s.sessions,
          ...Object.fromEntries(list.map((x) => [x.id, x])),
        },
        sessionsByWorkflow: {
          ...s.sessionsByWorkflow,
          [workflowId]: list.map((x) => x.id),
        },
      }))
    } catch (error) {
      reportError("Failed to load workflow sessions", error)
    }
  },

  ensureWorkflow: async (id) => {
    if (get().workflows[id]) return
    try {
      const wf = await ipc.getWorkflow(id)
      set((s) => ({ workflows: { ...s.workflows, [wf.id]: wf } }))
    } catch (error) {
      reportError("Failed to load workflow", error)
    }
  },

  createWorkflow: async (projectId, name) => {
    try {
      const wf = await ipc.createWorkflow(projectId, name, {
        nodes: [],
        edges: [],
      })
      set((s) => ({ workflows: { ...s.workflows, [wf.id]: wf } }))
      return wf
    } catch (error) {
      reportError("Failed to create workflow", error)
      return null
    }
  },

  saveWorkflowGraph: async (id, graph) => {
    set((s) => {
      const wf = s.workflows[id]
      return wf ? { workflows: { ...s.workflows, [id]: { ...wf, graph } } } : {}
    })
    try {
      await ipc.updateWorkflow(id, undefined, graph)
    } catch (error) {
      reportError("Failed to save workflow", error)
    }
  },

  renameWorkflow: async (id, name) => {
    set((s) => {
      const wf = s.workflows[id]
      return wf ? { workflows: { ...s.workflows, [id]: { ...wf, name } } } : {}
    })
    try {
      await ipc.updateWorkflow(id, name)
    } catch (error) {
      reportError("Failed to rename workflow", error)
    }
  },

  duplicateWorkflow: async (id) => {
    const wf = get().workflows[id]
    if (!wf) return null
    try {
      const copy = await ipc.createWorkflow(
        wf.projectId,
        `${wf.name} copy`,
        wf.graph
      )
      set((s) => ({ workflows: { ...s.workflows, [copy.id]: copy } }))
      return copy
    } catch (error) {
      reportError("Failed to duplicate workflow", error)
      return null
    }
  },

  deleteWorkflow: async (id) => {
    try {
      await ipc.deleteWorkflow(id)
      get().closeTab(workflowTabId(id))
      set((s) => {
        const next = { ...s.workflows }
        delete next[id]
        const nextSessions = { ...s.sessionsByWorkflow }
        delete nextSessions[id]
        const nextStatus = { ...s.workflowRunStatusById }
        delete nextStatus[id]
        return {
          workflows: next,
          sessionsByWorkflow: nextSessions,
          workflowRunStatusById: nextStatus,
        }
      })
    } catch (error) {
      reportError("Failed to delete workflow", error)
    }
  },

  // Open a workflow as a real tab (closeable / splittable like a session).
  openWorkflow: (id) => {
    get().openTabRef(workflowTabId(id))
    set({ workflowRun: null })
    void get().ensureWorkflow(id)
  },

  runWorkflowById: async (id) => {
    try {
      const view = await ipc.runWorkflow(id, get().activeGroupId ?? undefined)
      set((s) => ({
        workflowRun: view,
        workflowRunStatusById: {
          ...s.workflowRunStatusById,
          [id]: view.run.status,
        },
      }))
      // Refresh the sidebar list — the executor's emit_session covers new
      // nodes, but this catches early/dropped events and the first expand.
      void get().loadWorkflowSessions(id)
    } catch (error) {
      reportError("Failed to run workflow", error)
    }
  },

  resumeRun: async (approve, runId) => {
    const targetId = runId ?? get().workflowRun?.run.id
    if (!targetId) return
    // Clear the gate toast immediately, whichever surface triggered the resume.
    toast.dismiss(`gate-${targetId}`)
    try {
      const view = await ipc.resumeWorkflow(targetId, approve)
      set((s) => ({
        // Only swap the viewed run if it's the one we resumed, so resuming a
        // backgrounded gate from the toast doesn't hijack the canvas.
        workflowRun:
          s.workflowRun?.run.id === view.run.id ? view : s.workflowRun,
        workflowRunStatusById: view.run.workflowId
          ? {
              ...s.workflowRunStatusById,
              [view.run.workflowId]: view.run.status,
            }
          : s.workflowRunStatusById,
      }))
    } catch (error) {
      reportError("Failed to resume workflow", error)
    }
  },

  loadWorkflowRun: async (id) => {
    try {
      const view = await ipc.getLatestWorkflowRun(id)
      set((s) => ({
        workflowRun: view,
        workflowRunStatusById: view
          ? { ...s.workflowRunStatusById, [id]: view.run.status }
          : s.workflowRunStatusById,
      }))
    } catch (error) {
      reportError("Failed to load workflow run", error)
    }
  },

  applyWorkflowRun: (view: WorkflowRunView) => {
    const prev = get().workflowRun
    const workflowId = view.run.workflowId ?? null
    // prevStatus spans every workflow (not just the currently-viewed one),
    // so a gate hit on a backgrounded workflow still fires its alert.
    const prevStatus = workflowId
      ? get().workflowRunStatusById[workflowId]
      : undefined

    const openTarget = workflowId
      ? () => get().openWorkflow(workflowId)
      : undefined
    const fire = (title: string, description: string) => {
      toast.warning(title, {
        description,
        action: openTarget
          ? { label: "Open workflow", onClick: openTarget }
          : undefined,
      })
      if (!windowFocused()) void notify(title, description)
    }

    // Hit a gate → run paused, needs your sign-off. The toast carries the
    // Approve/Reject actions directly so you can decide without opening it.
    if (view.run.status === "paused" && prevStatus !== "paused") {
      const runId = view.run.id
      toast.warning("Workflow waiting for your approval", {
        id: `gate-${runId}`,
        description:
          "A gate is holding the run. Approve or reject to continue.",
        duration: Infinity,
        action: {
          label: "Approve",
          onClick: () => void get().resumeRun(true, runId),
        },
        cancel: {
          label: "Reject",
          onClick: () => void get().resumeRun(false, runId),
        },
      })
      if (!windowFocused())
        void notify(
          "Workflow waiting for your approval",
          "A gate is holding the run."
        )
    }
    // Resolved by any surface (toast, node button, or the backend) → clear it.
    if (prevStatus === "paused" && view.run.status !== "paused") {
      toast.dismiss(`gate-${view.run.id}`)
    }

    // A node started waiting on AskUserQuestion. Compared against the prev
    // view of this same run (so we toast once per new question, not every tick).
    if (!prev || prev.run.id === view.run.id) {
      const wasWaiting = new Set(
        (prev?.nodes ?? [])
          .filter((n) => n.status === "awaitingInput")
          .map((n) => n.nodeId)
      )
      if (
        view.nodes.some(
          (n) => n.status === "awaitingInput" && !wasWaiting.has(n.nodeId)
        )
      ) {
        fire(
          "A workflow agent is asking a question",
          "Open the waiting node to answer so the run can continue."
        )
      }
    }

    set((s) => {
      // Always mirror status into the sidebar map — even runs we're not
      // currently viewing should tint their workflow row in the sidebar.
      const status = workflowId
        ? { ...s.workflowRunStatusById, [workflowId]: view.run.status }
        : s.workflowRunStatusById
      const workflowRun =
        s.workflowRun && s.workflowRun.run.id !== view.run.id
          ? s.workflowRun
          : view
      return { workflowRun, workflowRunStatusById: status }
    })
  },
})
