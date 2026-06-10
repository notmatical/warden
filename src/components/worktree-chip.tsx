import {
  AlertTriangle,
  Check,
  Copy,
  FolderGit2,
  FolderOpen,
  GitBranch,
  Loader2,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { copyText } from "@/lib/clipboard"
import * as ipc from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"

/** Where-am-I-running chip for the composer: shows the session's worktree
 *  branch (or "checkout") and opens a menu with the full identity — branch,
 *  base, on-disk path — plus reveal/copy actions and the isolation opt-out.
 *  Replaces the old bare icon toggle, which read as decoration. */
export function WorktreeChip({ sessionId }: { sessionId: string }) {
  const session = useAppStore((s) => s.sessions[sessionId])
  const setIsolation = useAppStore((s) => s.setIsolation)
  const projectIsGit = useAppStore((s) => {
    const projectId = session?.projectId
    if (!projectId) return false
    for (const roots of Object.values(s.rootsByGroup)) {
      const root = roots.find((p) => p.id === projectId)
      if (root) return root.isGit
    }
    return false
  })
  const [copied, setCopied] = useState(false)

  // No git, no worktree story to tell.
  if (!session || !projectIsGit) return null

  const isolated = session.isIsolated
  const started = session.turns > 0
  const setup = session.setupStatus

  const copyPath = async () => {
    if (await copyText(session.workingDir)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } else {
      toast.error("Couldn't copy the path")
    }
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className={cn(
            "max-w-48 gap-1.5 font-normal",
            isolated ? "text-foreground/80" : "text-muted-foreground"
          )}
        >
          {isolated ? (
            <GitBranch className="size-3 text-primary" />
          ) : (
            <FolderGit2 className="size-3" />
          )}
          <span className="truncate font-mono text-[11px]">
            {isolated ? (session.branch ?? "worktree") : "checkout"}
          </span>
          {setup === "running" ? (
            <Loader2 className="size-3 animate-spin text-muted-foreground" />
          ) : setup === "failed" ? (
            <AlertTriangle className="size-3 text-destructive" />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
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
        <div className="px-2 py-1.5">
          <p className="text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
            Path
          </p>
          <p
            className="mt-0.5 cursor-text truncate font-mono text-[11px] text-muted-foreground select-text"
            title={session.workingDir}
          >
            {session.workingDir}
          </p>
        </div>
        <DropdownMenuItem onSelect={() => void copyPath()} className="gap-2">
          {copied ? (
            <Check className="size-3.5 text-emerald-500" />
          ) : (
            <Copy className="size-3.5 text-muted-foreground" />
          )}
          Copy path
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => void ipc.openIn("folder", session.workingDir)}
          className="gap-2"
        >
          <FolderOpen className="size-3.5 text-muted-foreground" />
          Reveal in file explorer
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {started ? (
          <p className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
            Where a session runs is fixed once it has started.
          </p>
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
