import { Link2, ListTodo, Loader2, RefreshCw, Settings2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"

import { useLinearIssues } from "../hooks"
import { linearBinding, linearStatus } from "../ipc"
import type { LinearBinding, LinearComment, LinearIssue } from "../types"
import { BindRepoDialog } from "./bind-repo-dialog"
import { IssueList } from "./issue-list"
import { IssuePeekPanel } from "./issue-peek-panel"
import { SendToAgentDialog } from "./send-to-agent-dialog"

type Phase = "loading" | "disconnected" | "unbound" | "bound"

/** The Tasks tab of a folder dashboard: this repo's Linear issues, scoped by
 *  its .warden/config.json binding. The cache is assigned-to-me only, so this
 *  is "your issues" in the bound team, not the team's whole board. */
export function FolderTasksSection({ projectId }: { projectId: string }) {
  const openTab = useAppStore((s) => s.openTab)
  const [phase, setPhase] = useState<Phase>("loading")
  const [binding, setBinding] = useState<LinearBinding | null>(null)
  const [bindOpen, setBindOpen] = useState(false)

  const { issues, syncing, error, loadCached, syncNow } = useLinearIssues()

  const refresh = useCallback(async () => {
    try {
      const { connected } = await linearStatus()
      if (!connected) {
        setPhase("disconnected")
        return
      }
      const bound = await linearBinding(projectId)
      setBinding(bound)
      if (bound) {
        setPhase("bound")
        await loadCached()
      } else {
        setPhase("unbound")
      }
    } catch {
      setPhase("disconnected")
    }
  }, [projectId, loadCached])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const scoped = binding
    ? issues.filter(
        (i) =>
          i.team.id === binding.teamId &&
          (!binding.projectId || i.project?.id === binding.projectId)
      )
    : []

  const teamName = scoped[0]?.team.name ?? "the bound team"

  const [peekId, setPeekId] = useState<string | null>(null)
  const peekIssue = scoped.find((i) => i.id === peekId) ?? null

  const [send, setSend] = useState<{
    issue: LinearIssue
    comments: LinearComment[]
  } | null>(null)

  if (phase === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  }

  if (phase === "disconnected") {
    return (
      <EmptyState
        icon={<ListTodo className="size-6" />}
        title="Connect Linear"
        body="Connect Linear from the Tasks view to see this repo's issues here."
        action={
          <Button variant="secondary" size="sm" onClick={() => openTab("tasks")}>
            Open Tasks
          </Button>
        }
      />
    )
  }

  if (phase === "unbound") {
    return (
      <>
        <EmptyState
          icon={<Link2 className="size-6" />}
          title="Bind this repo to a Linear team"
          body="Pick the team (and optionally project) whose issues belong to this codebase. The binding is committed with the repo."
          action={
            <Button size="sm" onClick={() => setBindOpen(true)}>
              Bind to Linear
            </Button>
          }
        />
        <BindRepoDialog
          projectId={projectId}
          existing={null}
          open={bindOpen}
          onOpenChange={setBindOpen}
          onBound={() => void refresh()}
        />
      </>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2">
        <span className="text-muted-foreground text-xs">
          Your issues in {teamName}
        </span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh"
          onClick={() => void syncNow()}
          disabled={syncing}
          className="text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Edit binding"
          onClick={() => setBindOpen(true)}
          className="text-muted-foreground hover:text-foreground"
        >
          <Settings2 className="size-3.5" />
        </Button>
      </div>

      <IssueList
        issues={scoped}
        syncing={syncing}
        error={error}
        emptyMessage="No issues assigned to you in this team."
        onSelect={(issue) => setPeekId(issue.id)}
      />

      <IssuePeekPanel
        open={peekId !== null}
        issue={peekIssue}
        onOpenChange={(open) => {
          if (!open) setPeekId(null)
        }}
        onSendToAgent={(issue, comments) => setSend({ issue, comments })}
      />

      <SendToAgentDialog
        issue={send?.issue ?? null}
        comments={send?.comments ?? []}
        open={send !== null}
        onOpenChange={(open) => {
          if (!open) setSend(null)
        }}
        defaultProjectId={projectId}
        onSent={() => setPeekId(null)}
      />

      <BindRepoDialog
        projectId={projectId}
        existing={binding}
        open={bindOpen}
        onOpenChange={setBindOpen}
        onBound={() => void refresh()}
      />
    </div>
  )
}

function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode
  title: string
  body: string
  action: React.ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-muted/50 text-muted-foreground">
        {icon}
      </div>
      <div className="space-y-1">
        <h2 className="font-medium text-foreground text-sm">{title}</h2>
        <p className="max-w-xs text-muted-foreground text-xs">{body}</p>
      </div>
      {action}
    </div>
  )
}
