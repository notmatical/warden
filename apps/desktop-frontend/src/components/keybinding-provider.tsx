import { type ReactNode, useEffect } from "react"

import { cycleMode } from "@/components/controls/mode-menu"
import {
  COMMAND_IDS,
  COMMANDS,
  type CommandId,
  emitUiCommand,
  resolveCombo,
} from "@/lib/commands"
import { isEditableTarget, matchCombo } from "@/lib/keybindings"
import { useAppStore } from "@/store/app-store"

/** Run a command by id. The single place that knows what each command does —
 *  invoked by keybindings (and, later, a command palette / menus). */
export function runCommand(id: CommandId): void {
  const store = useAppStore.getState()
  const activeTabId = store.activeTabId
  const session = activeTabId ? store.sessions[activeTabId] : undefined

  switch (id) {
    case "palette.toggle":
      emitUiCommand("palette.toggle", null)
      break
    case "sidebar.toggle":
      store.setSidebarCollapsed(!store.sidebarCollapsed)
      break
    case "tabs.next":
    case "tabs.previous": {
      const { openTabs } = store
      if (openTabs.length < 2) break
      const index = activeTabId ? openTabs.indexOf(activeTabId) : -1
      const delta = id === "tabs.next" ? 1 : -1
      const next = openTabs[(index + delta + openTabs.length) % openTabs.length]
      if (next) store.selectTab(next)
      break
    }
    case "session.cancel":
      if (session?.status === "running") void store.cancel(session.id)
      break
    case "session.cycleMode":
      if (session) {
        void store.updateSession(session.id, {
          permissionMode: cycleMode(session.permissionMode),
        })
      }
      break
    case "composer.toggleModelMenu":
      // Only agent sessions have a model menu; the active composer toggles it.
      if (session?.kind === "agent") {
        emitUiCommand("composer.toggleModelMenu", session.id)
      }
      break
  }
}

/** Installs the single global key listener that resolves each command's bound
 *  combo and dispatches it. Bindings are skipped in text fields unless the
 *  command opts in via `allowInInput`. */
export function KeybindingProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const editable = isEditableTarget(event.target)
      for (const id of COMMAND_IDS) {
        if (!COMMANDS[id].allowInInput && editable) continue
        if (!matchCombo(resolveCombo(id), event)) continue
        event.preventDefault()
        runCommand(id)
        return
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return <>{children}</>
}
