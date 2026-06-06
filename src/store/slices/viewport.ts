import type { StateCreator } from "zustand";

import {
	detachSession,
	emptyTree,
	firstLeaf,
	leaves,
	makeLeaf,
	setLeafSession,
	splitLeaf,
} from "@/lib/pane-tree";
import { isWorkflowTab } from "@/lib/tab-ref";
import * as terminals from "@/lib/terminal-instances";
import { readView, writeView } from "@/lib/view";
import { showSession } from "../shared";
import type { AppState } from "../types";

type ViewportSlice = Pick<
	AppState,
	| "openTabs"
	| "activeSessionId"
	| "layout"
	| "draggingSessionId"
	| "restoreView"
	| "setLayout"
	| "assignToPane"
	| "splitPane"
	| "setDragging"
	| "reorderTab"
	| "saveView"
	| "openSession"
	| "openTabRef"
	| "selectSession"
	| "closeTab"
	| "closeOthers"
>;

/** The browser-global viewport: open tabs, the focused session, and the
 *  recursive split-tree pane layout (persisted via the view store). */
export const createViewportSlice: StateCreator<
	AppState,
	[],
	[],
	ViewportSlice
> = (set, get) => ({
	openTabs: [],
	activeSessionId: null,
	layout: emptyTree(),
	draggingSessionId: null,

	// Restore the persisted global view, dropping references to sessions that no
	// longer exist. Called once after all groups load.
	restoreView: () => {
		const saved = readView();
		if (!saved) return;
		const { sessions } = get();
		// Keep session tabs that still exist, plus any non-session tab (workflows
		// self-hydrate). Sessions are loaded by now; workflows may not be.
		const exists = (id: string) =>
			sessions[id] !== undefined || isWorkflowTab(id);
		const openTabs = saved.openTabs.filter(exists);
		// Drop panes pointing at sessions that are gone or no longer open.
		let layout = saved.layout;
		for (const leaf of leaves(layout)) {
			if (leaf.sessionId && !openTabs.includes(leaf.sessionId)) {
				layout = detachSession(layout, leaf.sessionId);
			}
		}
		const activeSessionId =
			saved.activeSessionId && openTabs.includes(saved.activeSessionId)
				? saved.activeSessionId
				: (openTabs[0] ?? null);
		set({ openTabs, activeSessionId, layout });
		if (activeSessionId && !get().eventsBySession[activeSessionId]) {
			void get().loadEvents(activeSessionId);
		}
	},

	setLayout: (layout) => {
		set({ layout });
		get().saveView();
	},

	assignToPane: (leafId, sessionId) => {
		set((state) => {
			const openTabs = state.openTabs.includes(sessionId)
				? state.openTabs
				: [...state.openTabs, sessionId];
			// Move the session out of any pane it already occupies, then into the
			// drop target (replacing whatever it held). If the target collapsed
			// during the move, fall back to the focused pane.
			let layout = detachSession(state.layout, sessionId);
			const exists = leaves(layout).some((l) => l.id === leafId);
			layout = exists
				? setLeafSession(layout, leafId, sessionId)
				: showSession(layout, state.activeSessionId, sessionId);
			return { openTabs, activeSessionId: sessionId, layout };
		});
		get().saveView();
	},

	splitPane: (leafId, side, sessionId) => {
		set((state) => {
			const openTabs = state.openTabs.includes(sessionId)
				? state.openTabs
				: [...state.openTabs, sessionId];
			// Move out of any current pane first so a session never shows twice.
			let layout = detachSession(state.layout, sessionId);
			const exists = leaves(layout).some((l) => l.id === leafId);
			layout = exists
				? splitLeaf(layout, leafId, side, sessionId)
				: showSession(layout, state.activeSessionId, sessionId);
			return { openTabs, activeSessionId: sessionId, layout };
		});
		get().saveView();
	},

	setDragging: (sessionId) => set({ draggingSessionId: sessionId }),

	reorderTab: (draggedId, targetId) => {
		if (draggedId === targetId) return;
		set((state) => {
			const tabs = [...state.openTabs];
			const from = tabs.indexOf(draggedId);
			if (from === -1 || !tabs.includes(targetId)) return {};
			tabs.splice(from, 1);
			tabs.splice(tabs.indexOf(targetId), 0, draggedId);
			return { openTabs: tabs };
		});
		get().saveView();
	},

	saveView: () => {
		const { openTabs, activeSessionId, layout } = get();
		writeView({ openTabs, activeSessionId, layout });
	},

	// Open a session into a tab (from the sidebar) and focus it. If it isn't
	// already shown in a pane, it takes over the focused pane.
	openSession: (id) => {
		const session = get().sessions[id];
		if (!session) {
			return;
		}
		set((state) => ({
			// Focus the session's group in the sidebar (new sessions land there).
			activeGroupId: session.groupId,
			openTabs: state.openTabs.includes(id)
				? state.openTabs
				: [...state.openTabs, id],
			activeSessionId: id,
			layout: showSession(state.layout, state.activeSessionId, id),
		}));
		get().saveView();
		if (!get().eventsBySession[id]) {
			void get().loadEvents(id);
		}
	},

	// Open any tab content (session or workflow) into a pane and focus it.
	openTabRef: (ref) => {
		set((state) => ({
			openTabs: state.openTabs.includes(ref)
				? state.openTabs
				: [...state.openTabs, ref],
			activeSessionId: ref,
			layout: showSession(state.layout, state.activeSessionId, ref),
		}));
		get().saveView();
	},

	// Focus an open tab. If it's visible in a pane we just focus it; otherwise it
	// swaps into the focused pane.
	selectSession: (id) => {
		if (!get().sessions[id] && !isWorkflowTab(id)) {
			return;
		}
		set((state) => ({
			activeSessionId: id,
			layout: showSession(state.layout, state.activeSessionId, id),
		}));
		get().saveView();
		if (!isWorkflowTab(id) && !get().eventsBySession[id]) {
			void get().loadEvents(id);
		}
	},

	closeTab: (id) => {
		// Closing a terminal tab kills its PTY (no orphan processes); the session
		// row survives in the sidebar and reopens to a resume prompt.
		if (get().sessions[id]?.kind === "terminal") {
			terminals.dispose(id);
		}
		set((state) => {
			const prevTabs = state.openTabs;
			const openTabs = prevTabs.filter((sid) => sid !== id);
			// Collapse the pane showing the closed session (or clear the sole pane).
			let layout = detachSession(state.layout, id);
			let activeSessionId = state.activeSessionId;
			if (activeSessionId === id) {
				const closedIndex = prevTabs.indexOf(id);
				const nextTab =
					openTabs[closedIndex] ??
					openTabs[closedIndex - 1] ??
					openTabs[0] ??
					null;
				// Prefer a pane that's still visible; otherwise show the next tab.
				activeSessionId = firstLeaf(layout).sessionId ?? nextTab;
				if (activeSessionId) {
					layout = showSession(layout, activeSessionId, activeSessionId);
				}
			}
			return { openTabs, activeSessionId, layout };
		});
		get().saveView();
	},

	closeOthers: (id) => {
		const { openTabs, sessions } = get();
		if (!openTabs.includes(id)) return;
		for (const sid of openTabs) {
			if (sid !== id && sessions[sid]?.kind === "terminal") {
				terminals.dispose(sid);
			}
		}
		// One tab left → collapse to a single full-screen pane showing it.
		set({ openTabs: [id], activeSessionId: id, layout: makeLeaf(id) });
		get().saveView();
	},
});
