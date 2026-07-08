import type { StateCreator } from "zustand"

import * as terminals from "@/lib/terminal-instances"
import {
  describeKind,
  detachRef,
  emptyTree,
  firstLeaf,
  leaves,
  makeLeaf,
  readView,
  setLeafRef,
  splitLeaf,
  writeView,
} from "@/lib/viewport"
import { showRef } from "../shared"
import type { AppState } from "../types"

type ViewportSlice = Pick<
  AppState,
  | "openTabs"
  | "activeTabId"
  | "layout"
  | "draggingSessionId"
  | "restoreView"
  | "setLayout"
  | "assignToPane"
  | "splitPane"
  | "setDragging"
  | "moveTab"
  | "saveView"
  | "openSession"
  | "openTab"
  | "selectTab"
  | "closeTab"
  | "closeOthers"
>

/** The browser-global viewport: open tabs, the focused tab, and the recursive
 *  split-tree pane layout (persisted via the view store). Content is generic
 *  over kind — sessions, workflows, settings, … — via the content registry. */
export const createViewportSlice: StateCreator<
  AppState,
  [],
  [],
  ViewportSlice
> = (set, get) => ({
  openTabs: [],
  activeTabId: null,
  layout: emptyTree(),
  draggingSessionId: null,

  // Restore the persisted global view, dropping refs that no longer resolve.
  // Called once after all groups load.
  restoreView: () => {
    const saved = readView()
    if (!saved) return
    const { sessions } = get()
    // Keep session tabs that still exist, plus any destination that persists
    // without a backing record (workflows self-hydrate; settings/tasks/issues
    // are singletons).
    const exists = (id: string) =>
      sessions[id] !== undefined || describeKind(id).persistsWithoutRecord
    const openTabs = saved.openTabs.filter(exists)
    // Drop panes pointing at refs that are gone or no longer open.
    let layout = saved.layout
    for (const leaf of leaves(layout)) {
      if (leaf.ref && !openTabs.includes(leaf.ref)) {
        layout = detachRef(layout, leaf.ref)
      }
    }
    const activeTabId =
      saved.activeTabId && openTabs.includes(saved.activeTabId)
        ? saved.activeTabId
        : (openTabs[0] ?? null)
    set({ openTabs, activeTabId, layout })
    if (
      activeTabId &&
      describeKind(activeTabId).loadsEvents &&
      !get().eventsBySession[activeTabId]
    ) {
      void get().loadEvents(activeTabId)
    }
  },

  setLayout: (layout) => {
    set({ layout })
    get().saveView()
  },

  assignToPane: (leafId, ref) => {
    set((state) => {
      const openTabs = state.openTabs.includes(ref)
        ? state.openTabs
        : [...state.openTabs, ref]
      // Move the ref out of any pane it already occupies, then into the drop
      // target (replacing whatever it held). If the target collapsed during the
      // move, fall back to the focused pane.
      let layout = detachRef(state.layout, ref)
      const exists = leaves(layout).some((l) => l.id === leafId)
      layout = exists
        ? setLeafRef(layout, leafId, ref)
        : showRef(layout, state.activeTabId, ref)
      return { openTabs, activeTabId: ref, layout }
    })
    get().saveView()
  },

  splitPane: (leafId, side, ref) => {
    set((state) => {
      const openTabs = state.openTabs.includes(ref)
        ? state.openTabs
        : [...state.openTabs, ref]
      // Move out of any current pane first so a ref never shows twice.
      let layout = detachRef(state.layout, ref)
      const exists = leaves(layout).some((l) => l.id === leafId)
      layout = exists
        ? splitLeaf(layout, leafId, side, ref)
        : showRef(layout, state.activeTabId, ref)
      return { openTabs, activeTabId: ref, layout }
    })
    get().saveView()
  },

  setDragging: (sessionId) => set({ draggingSessionId: sessionId }),

  // arrayMove semantics (remove, then insert at the target's pre-removal
  // index) so the drop lands exactly where dnd-kit's sortable preview showed.
  moveTab: (id, toIndex) => {
    set((state) => {
      const from = state.openTabs.indexOf(id)
      if (from === -1 || from === toIndex) return {}
      const tabs = [...state.openTabs]
      tabs.splice(from, 1)
      tabs.splice(toIndex, 0, id)
      return { openTabs: tabs }
    })
    get().saveView()
  },

  saveView: () => {
    const { openTabs, activeTabId, layout } = get()
    writeView({ openTabs, activeTabId, layout })
  },

  // Open any content ref into a pane and focus it. If it isn't already shown in
  // a pane, it takes over the focused pane. Loads events for kinds that need
  // them (sessions); other destinations self-hydrate.
  openTab: (ref) => {
    set((state) => ({
      openTabs: state.openTabs.includes(ref)
        ? state.openTabs
        : [...state.openTabs, ref],
      activeTabId: ref,
      layout: showRef(state.layout, state.activeTabId, ref),
    }))
    get().saveView()
    if (describeKind(ref).loadsEvents && !get().eventsBySession[ref]) {
      void get().loadEvents(ref)
    }
  },

  // Open a session from the sidebar: focus its group (new sessions land there),
  // then open + focus it like any tab.
  openSession: (id) => {
    const session = get().sessions[id]
    if (!session) {
      return
    }
    set({ activeGroupId: session.groupId })
    get().openTab(id)
  },

  // Focus an open tab. If it's visible in a pane we just focus it; otherwise it
  // swaps into the focused pane.
  selectTab: (ref) => {
    if (!get().sessions[ref] && !describeKind(ref).persistsWithoutRecord) {
      return
    }
    set((state) => ({
      activeTabId: ref,
      layout: showRef(state.layout, state.activeTabId, ref),
    }))
    get().saveView()
    if (describeKind(ref).loadsEvents && !get().eventsBySession[ref]) {
      void get().loadEvents(ref)
    }
  },

  closeTab: (id) => {
    // Closing a terminal tab kills its PTY (no orphan processes); the session
    // row survives in the sidebar and reopens to a resume prompt.
    if (get().sessions[id]?.kind === "terminal") {
      terminals.dispose(id)
    }
    set((state) => {
      const prevTabs = state.openTabs
      const openTabs = prevTabs.filter((sid) => sid !== id)
      // Collapse the pane showing the closed ref (or clear the sole pane).
      let layout = detachRef(state.layout, id)
      let activeTabId = state.activeTabId
      if (activeTabId === id) {
        const closedIndex = prevTabs.indexOf(id)
        const nextTab =
          openTabs[closedIndex] ??
          openTabs[closedIndex - 1] ??
          openTabs[0] ??
          null
        // Prefer a pane that's still visible; otherwise show the next tab.
        activeTabId = firstLeaf(layout).ref ?? nextTab
        if (activeTabId) {
          layout = showRef(layout, activeTabId, activeTabId)
        }
      }
      return { openTabs, activeTabId, layout }
    })
    get().saveView()
  },

  closeOthers: (id) => {
    const { openTabs, sessions } = get()
    if (!openTabs.includes(id)) return
    for (const sid of openTabs) {
      if (sid !== id && sessions[sid]?.kind === "terminal") {
        terminals.dispose(sid)
      }
    }
    // One tab left → collapse to a single full-screen pane showing it.
    set({ openTabs: [id], activeTabId: id, layout: makeLeaf(id) })
    get().saveView()
  },
})
