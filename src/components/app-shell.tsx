import { useEffect } from "react"

import { cycleMode } from "@/components/controls/mode-menu"
import { EmptyState } from "@/components/empty-state"
import { useKeybinding } from "@/components/keybinding-provider"
import { SessionTabs } from "@/components/session-tabs"
import { SessionView } from "@/components/session-view"
import { Sidebar } from "@/components/sidebar"
import { Topbar } from "@/components/topbar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAppStore } from "@/store/app-store"

export function AppShell() {
  const init = useAppStore((s) => s.init)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)

  useEffect(() => {
    void init()
  }, [init])

  // Shift+Tab cycles the active session's mode (Plan → Accept edits → Bypass).
  useKeybinding({
    id: "cycle-execution-mode",
    combo: { key: "Tab", shift: true },
    allowInInput: true,
    description: "Cycle execution mode",
    handler: () => {
      const { activeSessionId: id, sessions, updateSession } =
        useAppStore.getState()
      const session = id ? sessions[id] : undefined
      if (!session) return
      void updateSession(session.id, {
        permissionMode: cycleMode(session.permissionMode),
      })
    },
  })

  // Ctrl/⌘+B toggles the project sidebar.
  useKeybinding({
    id: "toggle-sidebar",
    combo: { key: "b", mod: true },
    allowInInput: true,
    description: "Toggle the sidebar",
    handler: () => useAppStore.getState().toggleSidebar(),
  })

  return (
    <TooltipProvider>
      <div className="flex h-svh overflow-hidden bg-background text-foreground">
        {!sidebarCollapsed && <Sidebar />}
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <SessionTabs />
          <main className="min-h-0 flex-1">
            {!activeProjectId ? (
              <EmptyState variant="no-project" />
            ) : activeSessionId ? (
              <SessionView key={activeSessionId} sessionId={activeSessionId} />
            ) : (
              <EmptyState variant="no-session" />
            )}
          </main>
        </div>
      </div>
    </TooltipProvider>
  )
}
