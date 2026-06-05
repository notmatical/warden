import type { StateCreator } from "zustand";

import {
	clampWidth,
	readSidebarCollapsed,
	readSidebarWidth,
	SIDEBAR_KEY,
	SIDEBAR_WIDTH_KEY,
} from "../shared";
import type { AppState } from "../types";

type UiSlice = Pick<
	AppState,
	| "sidebarCollapsed"
	| "sidebarWidth"
	| "settingsOpen"
	| "settingsSection"
	| "setSidebarCollapsed"
	| "setSidebarWidth"
	| "openSettings"
	| "setSettingsOpen"
>;

/** Sidebar collapse/width (persisted to localStorage) and the settings dialog. */
export const createUiSlice: StateCreator<AppState, [], [], UiSlice> = (set) => ({
	sidebarCollapsed: readSidebarCollapsed(),
	sidebarWidth: readSidebarWidth(),
	settingsOpen: false,
	settingsSection: "providers",

	setSidebarCollapsed: (collapsed) => {
		try {
			localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
		} catch {
			// ignore storage failures
		}
		set({ sidebarCollapsed: collapsed });
	},

	setSidebarWidth: (width) => {
		const clamped = clampWidth(width);
		try {
			localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped));
		} catch {
			// ignore storage failures
		}
		set({ sidebarWidth: clamped });
	},

	openSettings: (section = "providers") =>
		set({ settingsOpen: true, settingsSection: section }),
	setSettingsOpen: (open) => set({ settingsOpen: open }),
});
