import { toast } from "sonner"

import { findLeafByRef, firstLeaf, setLeafRef } from "@/lib/viewport"
import type { PaneTree, Provider } from "@/types"

import type { TranscriptView } from "./types"

/** Surface a failed store action as an error toast. Handles Errors, the IPC
 *  boundary's `{ kind, message }` shape, and bare strings — never the useless
 *  `[object Object]`. */
export function reportError(scope: string, error: unknown) {
  toast.error(scope, { description: errorMessage(error) })
}

/** A human-readable message from any thrown/rejected value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message
  }
  return "Something went wrong."
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
  cursor: "cursor-agent",
  grok: "grok",
}

export const NATIVE_TITLE: Record<Provider, string> = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
  cursor: "Cursor",
  grok: "Grok",
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
