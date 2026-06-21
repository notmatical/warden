import {
  AlertTriangle,
  Check,
  FolderGit2,
  FolderOpen,
  GitBranch,
  Loader2,
  SquareTerminal,
} from "lucide-react"

import { Callout } from "@/components/ui/callout"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import * as ipc from "@/lib/ipc"
import { DEFAULT_CHAT_MODEL } from "@/lib/models"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"

/** The primary status chip's identity segment: repo name + branch, opening a
 *  menu with the session's where-am-I-running story — isolation state, base
 *  branch, setup progress — plus reveal/terminal actions and the isolation
 *  opt-out. Lives inside the chip so the worktree has exactly one home. */
export function WorktreeIdentity({
  sessionId,
  name,
  branch,
}: {
  sessionId: string
  name: string
  branch: string | null
}) {
  const session = useAppStore((s) => s.sessions[sessionId])
  const setIsolation = useAppStore((s) => s.setIsolation)
  const createSession = useAppStore((s) => s.createSession)
  const switching = useAppStore((s) => s.isolationPending[sessionId])

  if (!session) return null

  // Mid-switch the old branch/dir is already stale — replace the whole
  // identity segment with a live "what's happening" badge.
  if (switching) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <Loader2 className="size-3 shrink-0 animate-spin" />
        <span className="truncate">
          {switching === "worktree"
            ? "Creating worktree…"
            : "Moving to checkout…"}
        </span>
      </span>
    )
  }

  const isolated = session.isIsolated
  const started = session.turns > 0
  const setup = session.setupStatus

  // A shell in this exact directory — worktree or checkout alike.
  const openTerminal = () =>
    void createSession({
      projectId: session.projectId,
      title: "Terminal",
      model: DEFAULT_CHAT_MODEL,
      permissionMode: "bypassPermissions",
      role: "chat",
      kind: "terminal",
      workingDir: session.workingDir,
    })

  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="-mx-1 inline-flex min-w-0 items-center gap-1.5 rounded px-1 transition hover:bg-muted hover:text-foreground"
            >
              <span className="font-medium text-foreground/80">{name}</span>
              {branch ? (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <GitBranch
                    className={cn(
                      "size-3 shrink-0",
                      isolated ? "text-primary" : "opacity-60"
                    )}
                  />
                  <span className="truncate">{branch}</span>
                </span>
              ) : null}
              {setup === "running" ? (
                <Loader2 className="size-3 shrink-0 animate-spin" />
              ) : setup === "failed" ? (
                <AlertTriangle className="size-3 shrink-0 text-destructive" />
              ) : null}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {isolated
            ? `Isolated worktree on ${session.branch ?? "its own branch"}.`
            : `Direct checkout on ${session.branch ?? "this branch"}.`}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-72">
        <div className="px-2 py-1.5">
          <p className="text-xs font-medium">
            {isolated ? "Isolated worktree" : "Project checkout"}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {isolated
              ? `Changes land on a separate branch${session.baseBranch ? ` and merge back into ${session.baseBranch}` : ""}.`
              : "The agent works directly on your checked-out branch."}
          </p>
        </div>
        {isolated && session.branch ? (
          <div className="flex items-center gap-1.5 px-2 pb-1 text-[11px] text-muted-foreground">
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate font-mono">{session.branch}</span>
            {session.baseBranch ? (
              <span className="shrink-0">
                from <span className="font-mono">{session.baseBranch}</span>
              </span>
            ) : null}
          </div>
        ) : null}
        {setup === "running" ? (
          <div className="flex items-center gap-1.5 px-2 pb-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 shrink-0 animate-spin" />
            Running setup commands…
          </div>
        ) : setup === "done" ? (
          <div className="flex items-center gap-1.5 px-2 pb-1.5 text-[11px] text-muted-foreground">
            <Check className="size-3 shrink-0 text-emerald-500" />
            Setup commands completed
          </div>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => void ipc.openIn("folder", session.workingDir)}
          className="gap-2"
        >
          <FolderOpen className="size-3.5 text-muted-foreground" />
          Reveal in file explorer
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={openTerminal} className="gap-2">
          <SquareTerminal className="size-3.5 text-muted-foreground" />
          Open in terminal
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {started ? (
          <Callout variant="info" size="sm" className="m-1">
            Where a session runs is fixed once it has started.
          </Callout>
        ) : (
          <DropdownMenuItem
            onSelect={() => void setIsolation(sessionId, !isolated)}
            className="gap-2"
          >
            {isolated ? (
              <FolderGit2 className="size-3.5 text-muted-foreground" />
            ) : (
              <GitBranch className="size-3.5 text-muted-foreground" />
            )}
            <div className="min-w-0">
              <p>
                {isolated
                  ? "Run in the project checkout instead"
                  : "Isolate in a git worktree"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {isolated
                  ? "Work lands directly on your current branch."
                  : "Keeps the agent's changes off your branch."}
              </p>
            </div>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
