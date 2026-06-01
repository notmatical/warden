import { useState, type KeyboardEvent } from "react"
import { Pencil, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { StatusDot } from "@/components/status-dot"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"

function Tab({ sessionId }: { sessionId: string }) {
  const session = useAppStore((s) => s.sessions[sessionId])
  const active = useAppStore(
    (s) =>
      !!s.activeGroupId && s.activeSessionByGroup[s.activeGroupId] === sessionId
  )
  const order = useAppStore((s) =>
    s.activeGroupId ? s.tabsByGroup[s.activeGroupId] ?? [] : []
  )
  const selectSession = useAppStore((s) => s.selectSession)
  const closeTab = useAppStore((s) => s.closeTab)
  const closeOthers = useAppStore((s) => s.closeOthers)
  const renameSession = useAppStore((s) => s.renameSession)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")

  if (!session) {
    return null
  }

  const hasOthers = order.length > 1

  const startRename = () => {
    setDraft(session.title)
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
            "group flex h-9 max-w-56 min-w-36 shrink-0 cursor-pointer items-center gap-2 rounded-sm border px-3 text-sm transition-colors",
            active
              ? "border-border bg-card text-foreground"
              : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          )}
        >
          <StatusDot status={session.status} />
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onEditKeyDown}
              onBlur={commitRename}
              onClick={(e) => e.stopPropagation()}
              onFocus={(e) => e.target.select()}
              className="min-w-0 flex-1 rounded-sm bg-background px-1 text-sm outline-none ring-1 ring-border"
            />
          ) : (
            <span className="truncate" title={session.title}>
              {session.title}
            </span>
          )}
          {session.role !== "chat" && (
            <Badge variant="outline" className="capitalize">
              {session.role === "planner" ? "plan" : "code"}
            </Badge>
          )}
          <button
            type="button"
            aria-label="Close tab"
            onClick={(e) => {
              e.stopPropagation()
              closeTab(sessionId)
            }}
            className="-mr-1 ml-auto flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-muted hover:text-foreground aria-[current=true]:opacity-100"
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

export function SessionTabs() {
  const order = useAppStore((s) =>
    s.activeGroupId ? s.tabsByGroup[s.activeGroupId] ?? [] : []
  )

  if (order.length === 0) {
    return null
  }

  return (
    <ScrollArea className="w-full border-b border-border">
      <div className="flex gap-1 p-1.5">
        {order.map((id) => (
          <Tab key={id} sessionId={id} />
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  )
}
