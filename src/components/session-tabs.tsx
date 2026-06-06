import { useDraggable, useDroppable } from "@dnd-kit/core"
import {
  type LucideIcon,
  Pencil,
  Settings2,
  Workflow as WorkflowIcon,
  X,
} from "lucide-react"
import { type KeyboardEvent, useState } from "react"
import { SessionFavicon } from "@/components/session-favicon"
import { Badge } from "@/components/ui/badge"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { isSettingsTab, isWorkflowTab, workflowIdOf } from "@/lib/tab-ref"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"

function Tab({ sessionId }: { sessionId: string }) {
  // Narrow primitive selectors — re-render only when the rendered fields change.
  const title = useAppStore((s) => s.sessions[sessionId]?.title)
  const status = useAppStore((s) => s.sessions[sessionId]?.status)
  const role = useAppStore((s) => s.sessions[sessionId]?.role)
  const backend = useAppStore((s) => s.sessions[sessionId]?.backend)
  const kind = useAppStore((s) => s.sessions[sessionId]?.kind)
  const terminalCommand = useAppStore(
    (s) => s.sessions[sessionId]?.terminalCommand
  )
  const active = useAppStore((s) => s.activeSessionId === sessionId)
  const hasOthers = useAppStore((s) => s.openTabs.length > 1)
  // With a global tab strip, tabs from different workspaces sit side by side;
  // label the workspace (only when more than one exists).
  const workspace = useAppStore((s) => {
    if (s.groups.length < 2) return undefined
    const groupId = s.sessions[sessionId]?.groupId
    return groupId ? s.groups.find((g) => g.id === groupId)?.name : undefined
  })
  const selectSession = useAppStore((s) => s.selectSession)
  const closeTab = useAppStore((s) => s.closeTab)
  const closeOthers = useAppStore((s) => s.closeOthers)
  const renameSession = useAppStore((s) => s.renameSession)

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `tab:${sessionId}`,
    data: { sessionId },
  })
  // Reorder target: dropping another tab here moves it before this one.
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `tabdrop:${sessionId}`,
    data: { type: "tab", sessionId },
  })
  const draggingId = useAppStore((s) => s.draggingSessionId)
  const setRefs = (node: HTMLElement | null) => {
    setNodeRef(node)
    setDropRef(node)
  }
  const showInsert = isOver && draggingId !== null && draggingId !== sessionId

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")

  if (title === undefined || status === undefined) {
    return null
  }

  const tabIcon = (
    <SessionFavicon
      kind={kind}
      backend={backend}
      status={status}
      terminalCommand={terminalCommand}
      className="size-[18px]"
    />
  )

  const startRename = () => {
    setDraft(title)
    setEditing(true)
  }

  const commitRename = () => {
    setEditing(false)
    void renameSession(sessionId, draft)
  }

  const onEditKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key === "Enter") {
      event.preventDefault()
      commitRename()
    } else if (event.key === "Escape") {
      event.preventDefault()
      setEditing(false)
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setRefs}
          {...attributes}
          {...listeners}
          role="tab"
          aria-selected={active}
          tabIndex={0}
          onClick={() => selectSession(sessionId)}
          onDoubleClick={startRename}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              selectSession(sessionId)
            }
          }}
          className={cn(
            // The active tab grows to fit its title (never cut off); inactive
            // tabs stay capped and truncate, like a browser's tab strip.
            "group relative flex h-9 min-w-32 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2.5 text-[13px] transition-[background-color,color]",
            active
              ? "max-w-80 bg-muted text-foreground"
              : "max-w-48 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
            isDragging ? "opacity-50" : null
          )}
        >
          {/* Reorder insertion marker — a full-height bar on the leading edge. */}
          {showInsert ? (
            <span className="pointer-events-none absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary" />
          ) : null}
          {tabIcon}
          <span className="flex min-w-0 flex-1 flex-col justify-center leading-tight">
            {editing ? (
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onEditKeyDown}
                onBlur={commitRename}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.target.select()}
                className="min-w-0 rounded-md bg-background px-1 text-[13px] ring-1 ring-border outline-none"
              />
            ) : (
              <span className="truncate text-[13px]" title={title}>
                {title}
              </span>
            )}
            {workspace ? (
              <span
                className="truncate text-[10px] text-muted-foreground/55"
                title={workspace}
              >
                {workspace}
              </span>
            ) : null}
          </span>
          {role !== "chat" ? (
            <Badge variant="outline" className="capitalize">
              {role === "planner" ? "plan" : "code"}
            </Badge>
          ) : null}
          <button
            type="button"
            aria-label="Close tab"
            onClick={(e) => {
              e.stopPropagation()
              closeTab(sessionId)
            }}
            className="-mr-0.5 ml-auto flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition group-hover:opacity-100 group-aria-selected:opacity-100 hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={() => startRename()}>
          <Pencil />
          Rename
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => closeTab(sessionId)}>
          <X />
          Close
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!hasOthers}
          onSelect={() => closeOthers(sessionId)}
        >
          Close others
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** A non-session tab (workflow, settings) — fixed label + icon, no status/role,
 *  same drag/drop + close + context menu as a regular tab. */
function StaticTab({
  tabId,
  label,
  Icon,
}: {
  tabId: string
  label: string
  Icon: LucideIcon
}) {
  const active = useAppStore((s) => s.activeSessionId === tabId)
  const hasOthers = useAppStore((s) => s.openTabs.length > 1)
  const selectSession = useAppStore((s) => s.selectSession)
  const closeTab = useAppStore((s) => s.closeTab)
  const closeOthers = useAppStore((s) => s.closeOthers)

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `tab:${tabId}`,
    data: { sessionId: tabId },
  })
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `tabdrop:${tabId}`,
    data: { type: "tab", sessionId: tabId },
  })
  const draggingId = useAppStore((s) => s.draggingSessionId)
  const setRefs = (node: HTMLElement | null) => {
    setNodeRef(node)
    setDropRef(node)
  }
  const showInsert = isOver && draggingId !== null && draggingId !== tabId

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setRefs}
          {...attributes}
          {...listeners}
          role="tab"
          aria-selected={active}
          tabIndex={0}
          onClick={() => selectSession(tabId)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              selectSession(tabId)
            }
          }}
          className={cn(
            "group relative flex h-9 min-w-32 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2.5 text-[13px] transition-[background-color,color]",
            active
              ? "max-w-80 bg-muted text-foreground"
              : "max-w-48 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
            isDragging ? "opacity-50" : null
          )}
        >
          {showInsert ? (
            <span className="pointer-events-none absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary" />
          ) : null}
          <Icon className="size-[18px] shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[13px]" title={label}>
            {label}
          </span>
          <button
            type="button"
            aria-label="Close tab"
            onClick={(e) => {
              e.stopPropagation()
              closeTab(tabId)
            }}
            className="-mr-0.5 ml-auto flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition group-hover:opacity-100 group-aria-selected:opacity-100 hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={() => closeTab(tabId)}>
          <X />
          Close
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!hasOthers}
          onSelect={() => closeOthers(tabId)}
        >
          Close others
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function WorkflowTab({ tabId }: { tabId: string }) {
  const name = useAppStore((s) => s.workflows[workflowIdOf(tabId)]?.name)
  return (
    <StaticTab tabId={tabId} label={name ?? "Workflow"} Icon={WorkflowIcon} />
  )
}

function SettingsTab({ tabId }: { tabId: string }) {
  return <StaticTab tabId={tabId} label="Settings" Icon={Settings2} />
}

export function SessionTabs() {
  const order = useAppStore((s) => s.openTabs)

  if (order.length === 0) {
    return null
  }

  return (
    <ScrollArea className="w-full">
      <div className="flex gap-1 px-1.5 pt-1.5 pb-1">
        {order.map((id) =>
          isSettingsTab(id) ? (
            <SettingsTab key={id} tabId={id} />
          ) : isWorkflowTab(id) ? (
            <WorkflowTab key={id} tabId={id} />
          ) : (
            <Tab key={id} sessionId={id} />
          )
        )}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  )
}
