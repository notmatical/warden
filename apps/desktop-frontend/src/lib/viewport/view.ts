import type { PaneTree } from "@/types"
import { emptyTree, parseTree } from "./pane-tree"

/** The global viewport state — what's open, what's focused, how it's arranged.
 *  Persisted to localStorage (pure UI state); survives restarts without backend
 *  round-trips. */
export interface PersistedView {
  openTabs: string[]
  activeTabId: string | null
  layout: PaneTree
}

const VIEW_KEY = "warden:view"

export function readView(): PersistedView | null {
  try {
    const raw = localStorage.getItem(VIEW_KEY)
    if (!raw) return null
    // `activeSessionId` is the legacy key (pre content-engine rename) — accept it.
    const v = JSON.parse(raw) as Partial<PersistedView> & {
      activeSessionId?: string | null
    }
    const active =
      typeof v.activeTabId === "string"
        ? v.activeTabId
        : typeof v.activeSessionId === "string"
          ? v.activeSessionId
          : null
    return {
      openTabs: Array.isArray(v.openTabs)
        ? v.openTabs.filter((id): id is string => typeof id === "string")
        : [],
      activeTabId: active,
      layout: v.layout ? parseTree(v.layout) : emptyTree(),
    }
  } catch {
    return null
  }
}

export function writeView(view: PersistedView): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(view))
  } catch {
    // ignore storage failures
  }
}
