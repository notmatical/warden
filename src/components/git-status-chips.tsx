import { openUrl } from "@tauri-apps/plugin-opener"
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  FileDiff,
  GitBranch,
  GitPullRequest,
  Loader2,
  Plus,
  X,
  XCircle,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { LandSessionButton } from "@/components/land-session-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import * as ipc from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { diffTabId } from "@/lib/viewport"
import { useAppStore } from "@/store/app-store"
import type { CheckStatus, Project, RepoStatus } from "@/types"

// Stable empty reference so the `?? EMPTY` fallback doesn't allocate each run.
const EMPTY: Project[] = []

/** The chip's +N/−N changed-lines counter. With `onClick` (the primary repo of
 *  a session with a diff base) it's the doorway to the Changes tab. */
function Counter({
  added,
  removed,
  onClick,
}: {
  added: number
  removed: number
  onClick?: () => void
}) {
  if (added === 0 && removed === 0) return null
  const inner = (
    <>
      <span
        className={cn(
          added > 0 ? "text-emerald-500" : "text-muted-foreground/60"
        )}
      >
        +{added}
      </span>
      <span
        className={cn(
          removed > 0 ? "text-red-500" : "text-muted-foreground/60"
        )}
      >
        −{removed}
      </span>
    </>
  )
  if (!onClick) {
    return (
      <span className="inline-flex items-center gap-1 tabular-nums">
        {inner}
      </span>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className="-mx-0.5 inline-flex items-center gap-1 rounded px-0.5 tabular-nums transition hover:bg-muted hover:text-foreground"
        >
          {inner}
        </button>
      </TooltipTrigger>
      <TooltipContent>View the session's changes</TooltipContent>
    </Tooltip>
  )
}

/** An ahead/behind counter that becomes a push/pull button when a handler is
 *  given (the session's primary repo with a remote). */
function AheadBehind({
  count,
  dir,
  onClick,
  busy,
}: {
  count: number
  dir: "ahead" | "behind"
  onClick?: () => void
  busy?: boolean
}) {
  const Icon = busy ? Loader2 : dir === "ahead" ? ArrowUp : ArrowDown
  const inner = (
    <>
      <Icon className={cn("size-3", busy && "animate-spin")} />
      {count}
    </>
  )
  if (!onClick) {
    return (
      <span className="inline-flex items-center tabular-nums">{inner}</span>
    )
  }
  const verb = dir === "ahead" ? "Push" : "Pull"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={busy}
          className="-mx-0.5 inline-flex items-center gap-0.5 rounded px-0.5 tabular-nums transition hover:bg-muted hover:text-foreground"
        >
          {inner}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {verb} {count} commit{count === 1 ? "" : "s"}{" "}
        {dir === "ahead" ? "to" : "from"} the remote
      </TooltipContent>
    </Tooltip>
  )
}

function StatusChip({
  status,
  onRemove,
  onPush,
  onPull,
  onOpenDiff,
  pushing,
  pulling,
}: {
  status: RepoStatus
  onRemove?: () => void
  onPush?: () => void
  onPull?: () => void
  onOpenDiff?: () => void
  pushing?: boolean
  pulling?: boolean
}) {
  return (
    <span
      className={cn(
        "group/chip inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-xs text-muted-foreground",
        status.isPrimary ? "bg-muted/60" : "bg-muted/30"
      )}
      title={status.path}
    >
      <span
        className={cn("font-medium", status.isPrimary && "text-foreground/80")}
      >
        {status.name}
      </span>
      {status.branch ? (
        <span className="inline-flex items-center gap-1">
          <GitBranch className="size-3 opacity-60" />
          {status.branch}
        </span>
      ) : null}
      <Counter
        added={status.added}
        removed={status.removed}
        onClick={onOpenDiff}
      />
      {status.ahead > 0 ? (
        <AheadBehind
          count={status.ahead}
          dir="ahead"
          onClick={onPush}
          busy={pushing}
        />
      ) : null}
      {status.behind > 0 ? (
        <AheadBehind
          count={status.behind}
          dir="behind"
          onClick={onPull}
          busy={pulling}
        />
      ) : null}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${status.name} from this session`}
          className="-mr-0.5 ml-0.5 hidden size-4 items-center justify-center rounded text-muted-foreground/70 transition group-hover/chip:inline-flex hover:bg-muted hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </span>
  )
}

/** The PR's CI-check rollup, as a small leading glyph. */
function CheckGlyph({ status }: { status: CheckStatus | null }) {
  if (status === "pending")
    return <Loader2 className="size-3 animate-spin text-amber-500" />
  if (status === "failure") return <XCircle className="size-3 text-red-500" />
  if (status === "success")
    return <CheckCircle2 className="size-3 text-emerald-500" />
  return null
}

/** A link chip to the session's pull request, tinted by its state, with CI status. */
function PrChip({
  number,
  url,
  state,
  checkStatus,
}: {
  number: number
  url: string | null
  state: string | null
  checkStatus: CheckStatus | null
}) {
  const tone =
    state === "MERGED"
      ? "text-violet-500"
      : state === "CLOSED"
        ? "text-red-500"
        : "text-emerald-500"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => url && void openUrl(url)}
          className="inline-flex items-center gap-1 rounded-lg bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <GitPullRequest className={cn("size-3", tone)} />
          <span className="font-medium">#{number}</span>
          {state ? (
            <span className="text-[10px] text-muted-foreground/70">
              {state.toLowerCase()}
            </span>
          ) : null}
          <CheckGlyph status={checkStatus} />
        </button>
      </TooltipTrigger>
      <TooltipContent>View pull request #{number}</TooltipContent>
    </Tooltip>
  )
}

/** Rebase the session's worktree onto the latest base when it's behind. */
function SyncButton({
  sessionId,
  behind,
  refresh,
}: {
  sessionId: string
  behind: number
  refresh: () => void
}) {
  const sync = useAppStore((s) => s.syncWorktree)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    const outcome = await sync(sessionId)
    setBusy(false)
    if (!outcome) return
    if (outcome.status === "conflict") {
      toast.error("Sync stopped on conflicts", {
        description: `${outcome.files.join(", ")} — nothing was changed.`,
      })
      return
    }
    toast.success("Synced with base")
    refresh()
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => void run()}
          disabled={busy}
          className="gap-1 text-muted-foreground hover:text-foreground"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ArrowDown className="size-3.5" />
          )}
          Sync {behind}
        </Button>
      </TooltipTrigger>
      <TooltipContent>Rebase onto the latest base branch</TooltipContent>
    </Tooltip>
  )
}

// The session's roots are exactly the git-status rows; non-primary project ids
// are the editable set handed to `set_session_roots`.
function nonPrimaryIds(statuses: RepoStatus[]): string[] {
  return statuses.filter((s) => !s.isPrimary).map((s) => s.projectId)
}

function AddRootControl({
  sessionId,
  statuses,
  refresh,
}: {
  sessionId: string
  statuses: RepoStatus[]
  refresh: () => void
}) {
  // Roots come from the session's own group — not whatever group is focused in
  // the sidebar (tabs are browser-global, so they can differ).
  const groupId = useAppStore((s) => s.sessions[sessionId]?.groupId)
  const groupRoots = useAppStore((s) =>
    groupId ? (s.rootsByGroup[groupId] ?? EMPTY) : EMPTY
  )

  const add = useCallback(
    (projectId: string) => {
      void ipc
        .setSessionRoots(sessionId, [...nonPrimaryIds(statuses), projectId])
        .then(refresh)
        .catch(() => {})
    },
    [sessionId, statuses, refresh]
  )

  const onSession = new Set(statuses.map((s) => s.projectId))
  const available = groupRoots.filter((p) => !onSession.has(p.id))
  if (available.length === 0) return null

  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Add a repository to this session"
              className="text-muted-foreground hover:text-foreground"
            >
              <Plus />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Add a repository</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-56">
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
  const session = useAppStore((s) => s.sessions[sessionId])
  const refreshPrStatus = useAppStore((s) => s.refreshPrStatus)
  const openTab = useAppStore((s) => s.openTab)
  const primary = statuses.find((s) => s.isPrimary)
  const hasRemote = primary?.hasRemote ?? false
  const canSync =
    !!session?.isIsolated && !session.mergedAt && (primary?.behind ?? 0) > 0
  // Any session that recorded a fork point can show its changes — isolation
  // is irrelevant; in-checkout sessions diff against HEAD-at-start.
  const canViewDiff = !!session?.baseSha && !session.mergedAt

  // Re-check the PR's state whenever this session's view mounts.
  const prNumber = session?.prNumber ?? null
  useEffect(() => {
    if (prNumber) void refreshPrStatus(sessionId)
  }, [prNumber, sessionId, refreshPrStatus])

  const remove = useCallback(
    (projectId: string) => {
      void ipc
        .setSessionRoots(
          sessionId,
          nonPrimaryIds(statuses).filter((id) => id !== projectId)
        )
        .then(refresh)
        .catch(() => {})
    },
    [sessionId, statuses, refresh]
  )

  // Push/pull the primary worktree branch against its upstream tracking branch.
  const [pending, setPending] = useState<"push" | "pull" | null>(null)
  const push = useCallback(async () => {
    setPending("push")
    try {
      await ipc.pushSession(sessionId)
      toast.success("Pushed to remote")
      refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setPending(null)
    }
  }, [sessionId, refresh])
  const pull = useCallback(async () => {
    setPending("pull")
    try {
      const outcome = await ipc.pullSession(sessionId)
      if (outcome.status === "conflict") {
        toast.error("Pull stopped on conflicts", {
          description: `${outcome.files.join(", ")} — nothing was changed.`,
        })
      } else {
        toast.success("Pulled latest commits")
        refresh()
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setPending(null)
    }
  }, [sessionId, refresh])

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 px-1",
        statuses.length > 0 ? "pb-1.5" : "empty:hidden"
      )}
    >
      {statuses.map((status) => (
        <StatusChip
          key={status.projectId}
          status={status}
          onRemove={
            status.isPrimary ? undefined : () => remove(status.projectId)
          }
          onPush={status.isPrimary && status.hasRemote ? push : undefined}
          onPull={status.isPrimary && status.hasRemote ? pull : undefined}
          onOpenDiff={
            status.isPrimary && canViewDiff
              ? () => openTab(diffTabId(sessionId))
              : undefined
          }
          pushing={status.isPrimary && pending === "push"}
          pulling={status.isPrimary && pending === "pull"}
        />
      ))}
      <AddRootControl
        sessionId={sessionId}
        statuses={statuses}
        refresh={refresh}
      />
      <div className="ml-auto flex items-center gap-1.5">
        {canSync ? (
          <SyncButton
            sessionId={sessionId}
            behind={primary?.behind ?? 0}
            refresh={refresh}
          />
        ) : null}
        {session?.prNumber ? (
          <PrChip
            number={session.prNumber}
            url={session.prUrl}
            state={session.prState}
            checkStatus={session.prCheckStatus}
          />
        ) : null}
        {canViewDiff ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="View the session's changes"
                onClick={() => openTab(diffTabId(sessionId))}
                className="text-muted-foreground hover:text-foreground"
              >
                <FileDiff className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Changes & files</TooltipContent>
          </Tooltip>
        ) : null}
        <LandSessionButton
          sessionId={sessionId}
          hasRemote={hasRemote}
          refresh={refresh}
        />
      </div>
    </div>
  )
}
