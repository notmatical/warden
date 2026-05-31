import { X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { StatusDot } from "@/components/status-dot"
import { cn } from "@/lib/utils"
import { shortModel } from "@/lib/format"
import { useAppStore } from "@/store/app-store"

function Tab({ sessionId }: { sessionId: string }) {
  const session = useAppStore((s) => s.sessions[sessionId])
  const active = useAppStore((s) => s.activeSessionId === sessionId)
  const selectSession = useAppStore((s) => s.selectSession)
  const closeTab = useAppStore((s) => s.closeTab)

  if (!session) {
    return null
  }

  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={0}
      onClick={() => selectSession(sessionId)}
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
      <span className="truncate" title={session.title}>
        {session.title}
      </span>
      {session.role !== "chat" && (
        <Badge variant="outline" className="capitalize">
          {session.role === "planner" ? "plan" : "code"}
        </Badge>
      )}
      <span className="hidden shrink-0 text-xs text-muted-foreground/70 lg:inline">
        {shortModel(session.model)}
      </span>
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
  )
}

export function SessionTabs() {
  const order = useAppStore((s) => s.sessionOrder)

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
