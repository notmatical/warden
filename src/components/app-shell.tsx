import { useEffect } from "react"

import { cycleMode } from "@/components/controls/mode-menu"
import { EmptyState } from "@/components/empty-state"
import { useKeybinding } from "@/components/keybinding-provider"
import { SessionTabs } from "@/components/session-tabs"
import { SessionView } from "@/components/session-view"
import { Topbar } from "@/components/topbar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAppStore } from "@/store/app-store"

export function AppShell() {
  const init = useAppStore((s) => s.init)
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const activeSessionId = useAppStore((s) => s.activeSessionId)

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

  return (
    <TooltipProvider>
      <div className="flex h-svh flex-col overflow-hidden bg-background text-foreground">
        <Topbar />
        <SessionTabs />
        <main className="min-h-0 flex-1">
          {!activeWorkspaceId ? (
            <EmptyState variant="no-workspace" />
          ) : activeSessionId ? (
            <SessionView key={activeSessionId} sessionId={activeSessionId} />
          ) : (
            <EmptyState variant="no-session" />
          )}
        </main>
      </div>
    </TooltipProvider>
  )
}
