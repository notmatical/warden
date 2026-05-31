import { useEffect } from "react"

import { EmptyState } from "@/components/empty-state"
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
