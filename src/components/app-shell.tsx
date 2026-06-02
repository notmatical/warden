import { useCallback, useEffect } from "react"
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"

import { cycleMode } from "@/components/controls/mode-menu"
import { EmptyState } from "@/components/empty-state"
import { useKeybinding } from "@/components/keybinding-provider"
import { PaneGrid } from "@/components/pane-grid"
import { SessionTabs } from "@/components/session-tabs"
import { Sidebar } from "@/components/sidebar"
import { Topbar } from "@/components/topbar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { assignPane } from "@/lib/layout"
import { useAppStore } from "@/store/app-store"

export function AppShell() {
  const init = useAppStore((s) => s.init)
  const hasGroup = useAppStore((s) => s.activeGroupId !== null)
  const hasRoots = useAppStore((s) =>
    s.activeGroupId
      ? (s.rootsByGroup[s.activeGroupId]?.length ?? 0) > 0
      : false
  )
  const hasTabs = useAppStore((s) =>
    s.activeGroupId
      ? (s.tabsByGroup[s.activeGroupId]?.length ?? 0) > 0
      : false
  )
  const layout = useAppStore((s) =>
    s.activeGroupId ? s.layoutByGroup[s.activeGroupId] ?? null : null
  )
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed)

  const onOpenChange = useCallback(
    (open: boolean) => setSidebarCollapsed(!open),
    [setSidebarCollapsed]
  )

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
      const { activeGroupId, activeSessionByGroup, sessions, updateSession } =
        useAppStore.getState()
      const id = activeGroupId ? activeSessionByGroup[activeGroupId] : null
      const session = id ? sessions[id] : undefined
      if (!session) return
      void updateSession(session.id, {
        permissionMode: cycleMode(session.permissionMode),
      })
    },
  })

  // A small activation distance lets a plain click still select the tab while a
  // deliberate drag assigns it to a pane.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const onDragEnd = useCallback((event: DragEndEvent) => {
    const sessionId = event.active.data.current?.sessionId as
      | string
      | undefined
    const paneIndex = event.over?.data.current?.paneIndex as number | undefined
    if (!sessionId || paneIndex === undefined) return
    const { activeGroupId, layoutByGroup, setLayout } = useAppStore.getState()
    if (!activeGroupId) return
    const layout = layoutByGroup[activeGroupId]
    if (!layout) return
    setLayout(activeGroupId, assignPane(layout, paneIndex, sessionId))
  }, [])

  return (
    <TooltipProvider>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <SidebarProvider
          open={!sidebarCollapsed}
          onOpenChange={onOpenChange}
          className="h-svh min-h-0 overflow-hidden bg-background text-foreground"
        >
          <Sidebar />
          <SidebarInset className="min-w-0">
            <Topbar />
            <SessionTabs />
            <main className="min-h-0 flex-1">
              {!hasGroup ? (
                <EmptyState variant="no-project" />
              ) : !hasRoots ? (
                <EmptyState variant="no-root" />
              ) : hasTabs && layout ? (
                <PaneGrid layout={layout} />
              ) : (
                <EmptyState variant="no-session" />
              )}
            </main>
          </SidebarInset>
        </SidebarProvider>
      </DndContext>
    </TooltipProvider>
  )
}
