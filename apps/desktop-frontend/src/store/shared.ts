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
  opencode: "opencode",
}

export const NATIVE_TITLE: Record<Provider, string> = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
}

export const SIDEBAR_KEY = "warden:sidebar-collapsed"
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
export function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1"
  } catch {
    return false
  }
}
