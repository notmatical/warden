import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  defaultDropAnimationSideEffects,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { SidebarInset, SidebarProvider } from "@warden/ui/components/sidebar"
import { type CSSProperties, useCallback, useEffect, useState } from "react"

import { DragPreview } from "@/components/drag-preview"
import { EmptyState } from "@/components/empty-state"
import { PaneGrid } from "@/components/pane-grid"
import { Sidebar } from "@/components/sidebar"
import { Titlebar } from "@/components/titlebar"
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

  // Whether the drag is currently over the tab strip — the drop animation
  // glides the clone into its slot on reorder, but pane drops land instantly.
  const [overTab, setOverTab] = useState(false)

  const onDragOver = useCallback((event: DragOverEvent) => {
    setOverTab(event.over?.data.current?.type === "tab")
  }, [])

  const onDragEnd = useCallback((event: DragEndEvent) => {
    useAppStore.getState().setDragging(null)
    const sessionId = event.active.data.current?.sessionId as string | undefined
    const data = event.over?.data.current as
      | { type?: "tab"; sessionId?: string; leafId?: string; side?: SplitSide }
      | undefined
    if (!sessionId || !data) return
    const store = useAppStore.getState()
    // Dropped on a tab → commit the previewed reorder; on a pane → compose the
    // viewport.
    if (data.type === "tab" && data.sessionId) {
      const to = store.openTabs.indexOf(data.sessionId)
      if (to !== -1) store.moveTab(sessionId, to)
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
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        {/* Inset frame: the provider paints the window frame (bg-sidebar); the
            titlebar and sidebar sit on it, the content floats as a card. */}
        <SidebarProvider
          open={!sidebarCollapsed}
          onOpenChange={onOpenChange}
          keyboardShortcut={null}
          style={
            {
              "--header-height": "2.5rem",
              "--sidebar-top": "2.5rem",
            } as CSSProperties
          }
          className="h-svh min-h-svh flex-col overflow-hidden text-foreground"
        >
          <Titlebar />
          <div className="flex min-h-0 w-full flex-1">
            <Sidebar />
            <SidebarInset className="min-h-0 min-w-0 overflow-hidden md:peer-data-[variant=inset]:mt-0 md:peer-data-[variant=inset]:shadow-[0px_0px_2px_1px_#0000001A]">
              <div className="flex min-h-0 flex-1 flex-col">
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
              </div>
            </SidebarInset>
          </div>
        </SidebarProvider>
        <DragOverlay
          dropAnimation={
            overTab
              ? {
                  duration: 180,
                  easing: "cubic-bezier(0.23, 1, 0.32, 1)",
                  // Keep the hidden original invisible until the clone lands.
                  sideEffects: defaultDropAnimationSideEffects({
                    styles: { active: { opacity: "0" } },
                  }),
                }
              : null
          }
        >
          {draggingSessionId ? (
            <DragPreview sessionId={draggingSessionId} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </TooltipProvider>
  )
}
