import { memo } from "react"
import { useDroppable } from "@dnd-kit/core"
import { LayoutGrid } from "lucide-react"

import { SessionView } from "@/components/session-view"
import { StatusDot } from "@/components/status-dot"
import { PANE_COUNT } from "@/lib/layout"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"
import type { Layout, LayoutMode } from "@/types"

const GRID_CLASS: Record<LayoutMode, string> = {
  single: "grid-cols-1 grid-rows-1",
  "split-2": "grid-cols-2 grid-rows-1",
  "grid-4": "grid-cols-2 grid-rows-2",
}

function PaneHeader({ sessionId }: { sessionId: string }) {
  // Narrow primitive selectors so the header only re-renders on title/status
  // changes, not on every field of the session (turns, cost, updatedAt…).
  const title = useAppStore((s) => s.sessions[sessionId]?.title)
  const status = useAppStore((s) => s.sessions[sessionId]?.status)
  if (title === undefined || status === undefined) {
    return null
  }
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-sm">
      <StatusDot status={status} />
      <span className="truncate" title={title}>
        {title}
      </span>
    </div>
  )
}

function Pane({
  index,
  sessionId,
  active,
}: {
  index: number
  sessionId: string | null
  active: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `pane:${index}`,
    data: { paneIndex: index },
  })
  const selectSession = useAppStore((s) => s.selectSession)

  return (
    <div
      ref={setNodeRef}
      onMouseDownCapture={() => {
        if (sessionId) selectSession(sessionId)
      }}
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border bg-background transition-colors",
        active ? "border-ring ring-1 ring-ring/40" : "border-border",
        isOver ? "border-ring bg-muted/40" : null
      )}
    >
      {sessionId ? (
        <>
          <PaneHeader sessionId={sessionId} />
          <div className="relative min-h-0 flex-1">
            <SessionView key={sessionId} sessionId={sessionId} />
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
          <LayoutGrid className="size-5" />
          <p className="text-sm">Drop a tab here</p>
        </div>
      )}
    </div>
  )
}

const MemoPane = memo(Pane)

export function PaneGrid({ layout }: { layout: Layout }) {
  const activeSessionId = useAppStore((s) =>
    s.activeGroupId ? s.activeSessionByGroup[s.activeGroupId] ?? null : null
  )

  const count = PANE_COUNT[layout.mode]
  const cells: (string | null)[] = []
  for (let i = 0; i < count; i++) {
    const assigned = layout.panes[i] ?? null
    // single mode with no explicit assignment falls back to the active session
    cells.push(
      assigned ?? (layout.mode === "single" ? activeSessionId : null)
    )
  }

  return (
    <div className={cn("grid h-full gap-2 p-2", GRID_CLASS[layout.mode])}>
      {cells.map((sessionId, index) => (
        <MemoPane
          key={index}
          index={index}
          sessionId={sessionId}
          active={sessionId !== null && sessionId === activeSessionId}
        />
      ))}
    </div>
  )
}
