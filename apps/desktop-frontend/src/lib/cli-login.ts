import { toast } from "sonner"

import * as ipc from "@/lib/ipc"
import { defaultChatModel } from "@/lib/models"
import { isWindows } from "@/lib/platform"
import { useAppStore } from "@/store/app-store"

/** A resolved binary path as a runnable command token for the login terminal.
 *  On Windows that terminal is PowerShell, where a line starting with a quoted
 *  string is a string literal, not an invocation — so prefix the call operator
 *  `&`. Elsewhere (POSIX shells) a quoted path runs as-is. Falls back to the
 *  bare name, which is a command in either shell (no operator needed). */
export function shellBin(path: string | null, fallback: string): string {
  if (!path) return fallback
  return isWindows ? `& "${path}"` : `"${path}"`
}

/**
 * Open a fresh terminal session in the active project and run an interactive
 * login command (e.g. `claude`, `codex login`, `gh auth login`). Surfaces a
 * toast if no project is open to host the terminal.
 */
export async function runInLoginTerminal(
  title: string,
  command: string
): Promise<void> {
  const store = useAppStore.getState()
  const groupId = store.activeGroupId
  const projectId = groupId
    ? (store.rootsByGroup[groupId]?.[0]?.id ?? null)
    : null
  if (!projectId) {
    toast.error("Open a project first to sign in")
    return
  }

  const session = await store.createSession({
    projectId,
    title,
    model: defaultChatModel(),
    permissionMode: "bypassPermissions",
    role: "chat",
    kind: "terminal",
  })
  if (!session) return

  // The PTY spawns when the terminal pane mounts; give it a beat before typing.
  setTimeout(() => {
    void ipc.terminalWrite(session.id, `${command}\r`)
  }, 400)
}
