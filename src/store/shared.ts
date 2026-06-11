import { toast } from "sonner"

import { findLeafByRef, firstLeaf, setLeafRef } from "@/lib/viewport"
import type { PaneTree, Provider } from "@/types"

import type { TranscriptView } from "./types"

/** Surface a failed store action as an error toast. */
export function reportError(scope: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  toast.error(scope, { description: message })
}

/** Make `ref` visible and focused: if it's already in a pane, leave the tree
 *  as-is (the caller focuses it); otherwise drop it into the focused pane (the
 *  leaf showing `currentActive`, else the first leaf). */
export function showRef(
  tree: PaneTree,
  currentActive: string | null,
  ref: string
): PaneTree {
  if (findLeafByRef(tree, ref)) return tree
  const focused =
    (currentActive ? findLeafByRef(tree, currentActive) : undefined) ??
    firstLeaf(tree)
  return setLeafRef(tree, focused.id, ref)
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
export const TRANSCRIPT_VIEW_KEY = "warden:transcript-view"

export function readTranscriptView(): TranscriptView {
  try {
    return localStorage.getItem(TRANSCRIPT_VIEW_KEY) === "verbose"
      ? "verbose"
      : "normal"
  } catch {
    return "normal"
  }
}
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
