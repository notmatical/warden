import type { StateCreator } from "zustand"

import * as ipc from "@/lib/ipc"
import { reportError } from "../shared"
import type { AppState } from "../types"

type LabelsSlice = Pick<
  AppState,
  | "labelsByProject"
  | "labelIdsBySession"
  | "loadProjectLabels"
  | "createLabel"
  | "updateLabel"
  | "deleteLabel"
  | "setSessionLabels"
>

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name)

/** Per-project labels (GitHub-style) and their session attachments. Loaded on
 *  demand by the folder view. */
export const createLabelsSlice: StateCreator<AppState, [], [], LabelsSlice> = (
  set,
  get
) => ({
  labelsByProject: {},
  labelIdsBySession: {},

  loadProjectLabels: async (projectId) => {
    try {
      const { labels, assignments } = await ipc.loadProjectLabels(projectId)
      set((s) => ({
        labelsByProject: { ...s.labelsByProject, [projectId]: labels },
        labelIdsBySession: { ...s.labelIdsBySession, ...assignments },
      }))
    } catch (error) {
      reportError("Failed to load labels", error)
    }
  },

  createLabel: async (projectId, name, color) => {
    try {
      const label = await ipc.createLabel(projectId, name, color)
      set((s) => ({
        labelsByProject: {
          ...s.labelsByProject,
          [projectId]: [...(s.labelsByProject[projectId] ?? []), label].sort(
            byName
          ),
        },
      }))
      return label
    } catch (error) {
      reportError("Failed to create label", error)
      return null
    }
  },

  updateLabel: async (id, name, color) => {
    try {
      await ipc.updateLabel(id, name, color)
      set((s) => ({
        labelsByProject: Object.fromEntries(
          Object.entries(s.labelsByProject).map(([pid, labels]) => [
            pid,
            labels
              .map((l) => (l.id === id ? { ...l, name, color } : l))
              .sort(byName),
          ])
        ),
      }))
    } catch (error) {
      reportError("Failed to update label", error)
    }
  },

  deleteLabel: async (id) => {
    try {
      await ipc.deleteLabel(id)
      set((s) => ({
        labelsByProject: Object.fromEntries(
          Object.entries(s.labelsByProject).map(([pid, labels]) => [
            pid,
            labels.filter((l) => l.id !== id),
          ])
        ),
        labelIdsBySession: Object.fromEntries(
          Object.entries(s.labelIdsBySession).map(([sid, ids]) => [
            sid,
            ids.filter((lid) => lid !== id),
          ])
        ),
      }))
    } catch (error) {
      reportError("Failed to delete label", error)
    }
  },

  setSessionLabels: async (sessionId, labelIds) => {
    const prev = get().labelIdsBySession[sessionId] ?? []
    // Optimistic.
    set((s) => ({
      labelIdsBySession: { ...s.labelIdsBySession, [sessionId]: labelIds },
    }))
    try {
      await ipc.setSessionLabels(sessionId, labelIds)
    } catch (error) {
      reportError("Failed to update session labels", error)
      set((s) => ({
        labelIdsBySession: { ...s.labelIdsBySession, [sessionId]: prev },
      }))
    }
  },
})
