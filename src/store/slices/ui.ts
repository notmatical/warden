import type { StateCreator } from "zustand"

import { SETTINGS_TAB_ID } from "@/lib/viewport"

import {
  clampWidth,
  readSidebarCollapsed,
  readSidebarWidth,
  readTranscriptView,
  SIDEBAR_KEY,
  SIDEBAR_WIDTH_KEY,
  TRANSCRIPT_VIEW_KEY,
} from "../shared"
import type { AppState } from "../types"

type UiSlice = Pick<
  AppState,
  | "sidebarCollapsed"
  | "sidebarWidth"
  | "transcriptView"
  | "settingsSection"
  | "setSidebarCollapsed"
  | "setSidebarWidth"
  | "setTranscriptView"
  | "openSettings"
  | "setSettingsSection"
>

/** Sidebar collapse/width (persisted to localStorage) and the settings tab's
 *  remembered section. Settings opens as a real tab via `openTab`. */
export const createUiSlice: StateCreator<AppState, [], [], UiSlice> = (
  set,
  get
) => ({
  sidebarCollapsed: readSidebarCollapsed(),
  sidebarWidth: readSidebarWidth(),
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

  setSidebarWidth: (width) => {
    const clamped = clampWidth(width)
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped))
    } catch {
      // ignore storage failures
    }
    set({ sidebarWidth: clamped })
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
