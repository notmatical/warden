import { Link2, ListTodo, Loader2, RefreshCw, Settings2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { CountChip } from "@/components/common/count-chip"
import { FILTER_SURFACE } from "@/components/common/filter-menu"
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

/** The Tasks section of a folder dashboard: this repo's Linear issues, scoped
 *  by its .warden/config.json binding. The cache is assigned-to-me only, so
 *  this is "your issues" in the bound team, not the team's whole board. */
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

  const sectionTitle = (
    <span className="flex items-center gap-2">
      <h2 className="font-medium text-foreground text-sm">Tasks</h2>
      {phase === "bound" ? (
        <>
          <CountChip>{scoped.length}</CountChip>
          <span className="text-muted-foreground text-xs">
            your issues in {teamName}
          </span>
        </>
      ) : null}
    </span>
  )

  if (phase === "bound") {
    return (
      <section className="flex flex-col gap-3">
        <IssueList
          issues={scoped}
          syncing={syncing}
          error={error}
          emptyMessage="No issues assigned to you in this team."
          onSelect={(issue) => setPeekId(issue.id)}
          scroll={false}
          leading={sectionTitle}
          trailing={
            <>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Refresh"
                onClick={() => void syncNow()}
                disabled={syncing}
                className={cn(
                  "size-8 text-muted-foreground hover:bg-input/70 hover:text-foreground dark:hover:bg-input/70",
                  FILTER_SURFACE
                )}
              >
                <RefreshCw
                  className={cn("size-3.5", syncing && "animate-spin")}
                />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Edit binding"
                onClick={() => setBindOpen(true)}
                className={cn(
                  "size-8 text-muted-foreground hover:bg-input/70 hover:text-foreground dark:hover:bg-input/70",
                  FILTER_SURFACE
                )}
              >
                <Settings2 className="size-3.5" />
              </Button>
            </>
          }
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
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex h-8 shrink-0 items-center gap-2">{sectionTitle}</div>

      {phase === "loading" ? (
        <EmptyCard>
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </EmptyCard>
      ) : phase === "disconnected" ? (
        <EmptyCard
          icon={<ListTodo className="size-5" />}
          title="Connect Linear"
          body="Connect Linear from the Tasks view to see this repo's issues here."
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openTab("tasks")}
            >
              Open Tasks
            </Button>
          }
        />
      ) : (
        <EmptyCard
          icon={<Link2 className="size-5" />}
          title="Bind this repo to a Linear team"
          body="Pick the team (and optionally project) whose issues belong to this codebase. The binding is committed with the repo."
          action={
            <Button size="sm" onClick={() => setBindOpen(true)}>
              Bind to Linear
            </Button>
          }
        />
      )}

      <BindRepoDialog
        projectId={projectId}
        existing={binding}
        open={bindOpen}
        onOpenChange={setBindOpen}
        onBound={() => void refresh()}
      />
    </section>
  )
}

function EmptyCard({
  icon,
  title,
  body,
  action,
  children,
}: {
  icon?: React.ReactNode
  title?: string
  body?: string
  action?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl bg-card px-6 py-10 text-center shadow-xs ring-1 ring-foreground/10">
      {children}
      {icon ? (
        <div className="flex size-10 items-center justify-center rounded-xl bg-muted/50 text-muted-foreground">
          {icon}
        </div>
      ) : null}
      {title ? (
        <div className="space-y-1">
          <h3 className="font-medium text-foreground text-sm">{title}</h3>
          {body ? (
            <p className="max-w-sm text-muted-foreground text-xs">{body}</p>
          ) : null}
        </div>
      ) : null}
      {action}
    </div>
  )
}
