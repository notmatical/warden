import type { StateCreator } from "zustand"

import { SETTINGS_TAB_ID } from "@/lib/viewport"

import {
  readSidebarCollapsed,
  readTranscriptView,
  SIDEBAR_KEY,
  TRANSCRIPT_VIEW_KEY,
} from "../shared"
import type { AppState } from "../types"

type UiSlice = Pick<
  AppState,
  | "sidebarCollapsed"
  | "transcriptView"
  | "settingsSection"
  | "setSidebarCollapsed"
  | "setTranscriptView"
  | "openSettings"
  | "setSettingsSection"
>

/** Sidebar collapse (persisted to localStorage) and the settings tab's
 *  remembered section. Settings opens as a real tab via `openTab`. */
export const createUiSlice: StateCreator<AppState, [], [], UiSlice> = (
  set,
  get
) => ({
  sidebarCollapsed: readSidebarCollapsed(),
  transcriptView: readTranscriptView(),
  settingsSection: "providers",

  setSidebarCollapsed: (collapsed) => {
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0")
    } catch {
      // ignore storage failures
    }
    set({ sidebarCollapsed: collapsed })
  },

  setTranscriptView: (view) => {
    try {
      localStorage.setItem(TRANSCRIPT_VIEW_KEY, view)
    } catch {
      // ignore storage failures
    }
    set({ transcriptView: view })
  },

  openSettings: (section) => {
    if (section) set({ settingsSection: section })
    get().openTab(SETTINGS_TAB_ID)
  },

  setSettingsSection: (section) => set({ settingsSection: section }),
})
