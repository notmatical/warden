import { useCallback, useEffect, useState } from "react"
import { ArrowDown, ArrowUp, GitBranch, Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import * as ipc from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"
import type { Project, RepoStatus } from "@/types"

// Stable empty reference so the `?? EMPTY` fallback doesn't allocate each run.
const EMPTY: Project[] = []

function Counter({ added, removed }: { added: number; removed: number }) {
  const hasChanges = added > 0 || removed > 0
  if (!hasChanges) return null
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <span className={cn(added > 0 ? "text-emerald-500" : "text-muted-foreground/60")}>
        +{added}
      </span>
      <span className={cn(removed > 0 ? "text-red-500" : "text-muted-foreground/60")}>
        −{removed}
      </span>
    </span>
  )
}

function StatusChip({ status }: { status: RepoStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs text-muted-foreground",
        status.isPrimary ? "bg-muted/60" : "bg-muted/30"
      )}
      title={status.path}
    >
      <span className={cn("font-medium", status.isPrimary && "text-foreground/80")}>
        {status.name}
      </span>
      {status.branch ? (
        <span className="inline-flex items-center gap-1">
          <GitBranch className="size-3 opacity-60" />
          {status.branch}
        </span>
      ) : null}
      <Counter added={status.uncommittedAdded} removed={status.uncommittedRemoved} />
      {status.ahead > 0 ? (
        <span className="inline-flex items-center tabular-nums">
          <ArrowUp className="size-3" />
          {status.ahead}
        </span>
      ) : null}
      {status.behind > 0 ? (
        <span className="inline-flex items-center tabular-nums">
          <ArrowDown className="size-3" />
          {status.behind}
        </span>
      ) : null}
    </span>
  )
}

interface RootsControlProps {
  sessionId: string
  statuses: RepoStatus[]
  refresh: () => void
}

function RootsControl({ sessionId, statuses, refresh }: RootsControlProps) {
  const groupRoots = useAppStore((s) => {
    const groupId = s.activeGroupId
    return groupId ? (s.rootsByGroup[groupId] ?? EMPTY) : EMPTY
  })
  // Session roots are seeded from the backend and kept locally so add/remove
  // feels instant; the git-status hook reconciles the chips on next refresh.
  const [sessionRoots, setSessionRoots] = useState<Project[]>([])

  useEffect(() => {
    let active = true
    ipc
      .listSessionRoots(sessionId)
      .then((roots) => {
        if (active) setSessionRoots(roots)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [sessionId])

  const apply = useCallback(
    (projectIds: string[]) => {
      ipc
        .setSessionRoots(sessionId, projectIds)
        .then((roots) => {
          setSessionRoots(roots)
          refresh()
        })
        .catch(() => {})
    },
    [sessionId, refresh]
  )

  const onSessionIds = new Set(sessionRoots.map((p) => p.id))
  const available = groupRoots.filter((p) => !onSessionIds.has(p.id))
  const primaryId = statuses.find((s) => s.isPrimary)?.projectId
  const removable = sessionRoots.filter((p) => p.id !== primaryId)

  const add = useCallback(
    (projectId: string) => {
      apply([...sessionRoots.map((p) => p.id), projectId])
    },
    [apply, sessionRoots]
  )

  const remove = useCallback(
    (projectId: string) => {
      apply(sessionRoots.filter((p) => p.id !== projectId).map((p) => p.id))
    },
    [apply, sessionRoots]
  )

  if (available.length === 0 && removable.length === 0) return null

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          title="Add or remove roots for this session"
          className="text-muted-foreground hover:text-foreground"
        >
          <Plus />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {available.length > 0 ? (
          <>
            <DropdownMenuLabel>Add a root</DropdownMenuLabel>
            {available.map((project) => (
              <DropdownMenuItem
                key={project.id}
                onSelect={() => add(project.id)}
                className="gap-2"
              >
                <Plus className="size-3.5 text-muted-foreground" />
                <span className="truncate">{project.name}</span>
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
        {removable.length > 0 ? (
          <>
            <DropdownMenuLabel>Remove a root</DropdownMenuLabel>
            {removable.map((project) => (
              <DropdownMenuItem
                key={project.id}
                variant="destructive"
                onSelect={() => remove(project.id)}
                className="gap-2"
              >
                <X className="size-3.5" />
                <span className="truncate">{project.name}</span>
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface GitStatusChipsProps {
  statuses: RepoStatus[]
  sessionId: string
  refresh: () => void
}

export function GitStatusChips({
  statuses,
  sessionId,
  refresh,
}: GitStatusChipsProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 px-1",
        statuses.length > 0 ? "pb-1.5" : "empty:hidden"
      )}
    >
      {statuses.map((status) => (
        <StatusChip key={status.projectId} status={status} />
      ))}
      <RootsControl sessionId={sessionId} statuses={statuses} refresh={refresh} />
    </div>
  )
}
