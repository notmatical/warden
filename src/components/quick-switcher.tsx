import { Layers } from "lucide-react"

import { StatusDot } from "@/components/status-dot"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"

const EMPTY_IDS: string[] = []

function QuickSwitcherSession({ sessionId }: { sessionId: string }) {
  const session = useAppStore((s) => s.sessions[sessionId])
  const active = useAppStore(
    (s) =>
      !!s.activeGroupId && s.activeSessionByGroup[s.activeGroupId] === sessionId
  )
  const openSession = useAppStore((s) => s.openSession)

  if (!session) return null

  return (
    <button
      type="button"
      onClick={() => openSession(sessionId)}
      title={session.title}
      className={cn(
        "flex h-6 w-full items-center gap-2 rounded-md px-2 text-xs transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
      )}
    >
      <StatusDot status={session.status} />
      <span className="min-w-0 flex-1 truncate text-left">{session.title}</span>
    </button>
  )
}

function QuickSwitcherGroup({
  groupId,
  name,
}: {
  groupId: string
  name: string
}) {
  const active = useAppStore((s) => s.activeGroupId === groupId)
  const sessionIds = useAppStore((s) => s.sessionsByGroup[groupId]) ?? EMPTY_IDS
  const selectGroup = useAppStore((s) => s.selectGroup)

  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => void selectGroup(groupId)}
        title={name}
        className={cn(
          "flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-sm transition-colors",
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Layers className="size-3.5 shrink-0 opacity-70" />
        <span className="min-w-0 flex-1 truncate text-left font-medium">
          {name}
        </span>
      </button>
      {sessionIds.length > 0 ? (
        <div className="flex flex-col gap-0.5 pl-3.5">
          {sessionIds.map((id) => (
            <QuickSwitcherSession key={id} sessionId={id} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function QuickSwitcher() {
  const groups = useAppStore((s) => s.groups)

  if (groups.length === 0) {
    return (
      <p className="px-2 py-3 text-xs text-muted-foreground">No groups yet.</p>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      {groups.map((group) => (
        <QuickSwitcherGroup
          key={group.id}
          groupId={group.id}
          name={group.name}
        />
      ))}
    </div>
  )
}
