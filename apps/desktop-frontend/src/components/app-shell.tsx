import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { type CSSProperties, useCallback, useEffect } from "react"

import { DragPreview } from "@/components/drag-preview"
import { EmptyState } from "@/components/empty-state"
import { PaneGrid } from "@/components/pane-grid"
import { SessionTabs } from "@/components/session-tabs"
import { Sidebar } from "@/components/sidebar"
import { Titlebar } from "@/components/titlebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAppStore } from "@/store/app-store"
import type { SplitSide } from "@/types"

export function AppShell() {
  const init = useAppStore((s) => s.init)
  const hasGroup = useAppStore((s) => s.activeGroupId !== null)
  const hasRoots = useAppStore((s) =>
    s.activeGroupId ? (s.rootsByGroup[s.activeGroupId]?.length ?? 0) > 0 : false
  )
  const hasTabs = useAppStore((s) => s.openTabs.length > 0)
  const layout = useAppStore((s) => s.layout)
  const draggingSessionId = useAppStore((s) => s.draggingSessionId)
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed)

  const onOpenChange = useCallback(
    (open: boolean) => setSidebarCollapsed(!open),
    [setSidebarCollapsed]
  )

  useEffect(() => {
    void init()
  }, [init])

  // A small activation distance lets a plain click still select the tab while a
  // deliberate drag assigns it to a pane.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const onDragStart = useCallback((event: DragStartEvent) => {
    const sessionId = event.active.data.current?.sessionId as string | undefined
    useAppStore.getState().setDragging(sessionId ?? null)
  }, [])

  const onDragEnd = useCallback((event: DragEndEvent) => {
    useAppStore.getState().setDragging(null)
    const sessionId = event.active.data.current?.sessionId as string | undefined
    const data = event.over?.data.current as
      | { type?: "tab"; sessionId?: string; leafId?: string; side?: SplitSide }
      | undefined
    if (!sessionId || !data) return
    const store = useAppStore.getState()
    // Dropped on a tab → reorder the strip; on a pane → compose the viewport.
    if (data.type === "tab" && data.sessionId) {
      store.reorderTab(sessionId, data.sessionId)
    } else if (data.leafId) {
      if (!data.side || data.side === "center") {
        store.assignToPane(data.leafId, sessionId)
      } else {
        store.splitPane(data.leafId, data.side, sessionId)
      }
    }
  }, [])

  const onDragCancel = useCallback(() => {
    useAppStore.getState().setDragging(null)
  }, [])

  return (
    <TooltipProvider>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div
          style={{ "--header-height": "2.5rem" } as CSSProperties}
          className="relative flex h-svh min-h-0 flex-col overflow-hidden bg-background text-foreground"
        >
          <Titlebar />
          <SidebarProvider
            open={!sidebarCollapsed}
            onOpenChange={onOpenChange}
            className="relative min-h-0 flex-1 overflow-hidden"
          >
            <Sidebar />
            <SidebarInset className="min-w-0">
              <SessionTabs />
              <main className="min-h-0 flex-1">
                {/* Open tabs win — group-independent destinations (Workflows,
                    Settings, Tasks, Issues) render even with no groups. The
                    create-group / add-root guidance only shows when nothing's
                    open. */}
                {hasTabs && layout ? (
                  <PaneGrid layout={layout} />
                ) : !hasGroup ? (
                  <EmptyState variant="no-project" />
                ) : !hasRoots ? (
                  <EmptyState variant="no-root" />
                ) : (
                  <EmptyState variant="no-session" />
                )}
              </main>
            </SidebarInset>
          </SidebarProvider>
        </div>
        <DragOverlay dropAnimation={null}>
          {draggingSessionId ? (
            <DragPreview sessionId={draggingSessionId} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </TooltipProvider>
  )
}
