import { toast } from "sonner"

import { findSessionLeaf, firstLeaf, setLeafSession } from "@/lib/pane-tree"
import type { PaneTree, Provider } from "@/types"

/** Surface a failed store action as an error toast. */
export function reportError(scope: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  toast.error(scope, { description: message })
}

/** Make `sessionId` visible and focused: if it's already in a pane, leave the
 *  tree as-is (the caller focuses it); otherwise drop it into the focused pane
 *  (the leaf showing `currentActive`, else the first leaf). */
export function showSession(
  tree: PaneTree,
  currentActive: string | null,
  sessionId: string
): PaneTree {
  if (findSessionLeaf(tree, sessionId)) return tree
  const focused =
    (currentActive ? findSessionLeaf(tree, currentActive) : undefined) ??
    firstLeaf(tree)
  return setLeafSession(tree, focused.id, sessionId)
}

/** The interactive CLI a native terminal session launches, per provider. */
export const NATIVE_CLI: Record<Provider, string> = {
  claude: "claude",
  codex: "codex",
}

export const NATIVE_TITLE: Record<Provider, string> = {
  claude: "Claude",
  codex: "Codex",
}

export const SIDEBAR_KEY = "warden:sidebar-collapsed"
export const SIDEBAR_WIDTH_KEY = "warden:sidebar-width"
const DEFAULT_SIDEBAR_WIDTH = 256
const MIN_SIDEBAR_WIDTH = 208
const MAX_SIDEBAR_WIDTH = 420

export function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1"
  } catch {
    return false
  }
}

export function clampWidth(px: number): number {
  return Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.min(MAX_SIDEBAR_WIDTH, Math.round(px))
  )
}

export function readSidebarWidth(): number {
  try {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
    return Number.isFinite(stored) && stored > 0
      ? clampWidth(stored)
      : DEFAULT_SIDEBAR_WIDTH
  } catch {
    return DEFAULT_SIDEBAR_WIDTH
  }
}
