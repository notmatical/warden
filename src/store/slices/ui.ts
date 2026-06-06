import type { StateCreator } from "zustand";

import { SETTINGS_TAB_ID } from "@/lib/tab-ref";

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
	| "settingsSection"
	| "setSidebarCollapsed"
	| "setSidebarWidth"
	| "openSettings"
	| "setSettingsSection"
>;

/** Sidebar collapse/width (persisted to localStorage) and the settings tab's
 *  remembered section. Settings opens as a real tab via `openTabRef`. */
export const createUiSlice: StateCreator<AppState, [], [], UiSlice> = (
	set,
	get,
) => ({
	sidebarCollapsed: readSidebarCollapsed(),
	sidebarWidth: readSidebarWidth(),
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

	openSettings: (section) => {
		if (section) set({ settingsSection: section });
		get().openTabRef(SETTINGS_TAB_ID);
	},

	setSettingsSection: (section) => set({ settingsSection: section }),
});
