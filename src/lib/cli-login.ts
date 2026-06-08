import { toast } from "sonner"

import * as ipc from "@/lib/ipc"
import { DEFAULT_CHAT_MODEL } from "@/lib/models"
import { useAppStore } from "@/store/app-store"

/** Quote a resolved binary path for the shell; falls back to the bare name. */
export function shellBin(path: string | null, fallback: string): string {
  return path ? `"${path}"` : fallback
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
    model: DEFAULT_CHAT_MODEL,
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
