import { open } from "@tauri-apps/plugin-dialog"
import type { StateCreator } from "zustand"

import * as ipc from "@/lib/ipc"
import { detachRef, firstLeaf } from "@/lib/viewport"
import * as terminals from "@/lib/terminal-instances"
import { reportError } from "../shared"
import type { AppState } from "../types"

type GroupsSlice = Pick<
  AppState,
  | "groups"
  | "activeGroupId"
  | "rootsByGroup"
  | "sessionsByGroup"
  | "loadingGroups"
  | "loadGroupData"
  | "createGroup"
  | "selectGroup"
  | "renameGroup"
  | "deleteGroup"
  | "addRoot"
  | "removeRoot"
>

/** Workspace groups and their repo roots (the sidebar tree). `sessionsByGroup`
 *  is owned here but also written by session/git slices. */
export const createGroupsSlice: StateCreator<AppState, [], [], GroupsSlice> = (
  set,
  get
) => ({
  groups: [],
  activeGroupId: null,
  rootsByGroup: {},
  sessionsByGroup: {},
  loadingGroups: false,

  // Loads a group's roots and sessions into the store for the sidebar tree.
  // Purely organizational — the open tabs/layout are global (see restoreView).
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
        return {
          sessions: nextSessions,
          rootsByGroup: { ...state.rootsByGroup, [groupId]: roots },
          sessionsByGroup: {
            ...state.sessionsByGroup,
            [groupId]: sessions.map((s) => s.id),
          },
        }
      })
      // Load the group's workflows so the sidebar's Workflows section fills in.
      for (const project of roots) {
        void get().loadWorkflows(project.id)
      }
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
    const removed = new Set(get().sessionsByGroup[id] ?? [])
    set((state) => {
      const nextGroups = state.groups.filter((g) => g.id !== id)
      let activeGroupId = state.activeGroupId
      if (activeGroupId === id) {
        activeGroupId = nextGroups[0]?.id ?? null
      }
      const omit = <T>(record: Record<string, T>): Record<string, T> =>
        Object.fromEntries(Object.entries(record).filter(([gid]) => gid !== id))
      // The deleted group's sessions leave the global viewport too.
      const openTabs = state.openTabs.filter((sid) => !removed.has(sid))
      let layout = state.layout
      for (const sid of removed) layout = detachRef(layout, sid)
      const activeTabId =
        state.activeTabId && removed.has(state.activeTabId)
          ? (firstLeaf(layout).ref ?? openTabs[0] ?? null)
          : state.activeTabId
      return {
        groups: nextGroups,
        activeGroupId,
        rootsByGroup: omit(state.rootsByGroup),
        sessionsByGroup: omit(state.sessionsByGroup),
        openTabs,
        activeTabId,
        layout,
      }
    })
    get().saveView()
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
})
