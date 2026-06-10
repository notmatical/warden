import { RefreshCw, Settings2 } from "lucide-react"
import { useEffect, useState } from "react"

import { CountChip } from "@/components/common/count-chip"
import { FILTER_SURFACE } from "@/components/common/filter-menu"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { useLinearIssues } from "../hooks"
import type { LinearBinding, LinearComment, LinearIssue } from "../types"
import { BindRepoDialog } from "./bind-repo-dialog"
import { IssueList } from "./issue-list"
import { IssuePeekPanel } from "./issue-peek-panel"
import { SendToAgentDialog } from "./send-to-agent-dialog"

/** The Tasks section of a folder dashboard: this repo's Linear issues, scoped
 *  by its binding. Rendered only when the repo is bound (FolderView gates on
 *  useFolderLinearBinding). The cache is assigned-to-me only, so this is
 *  "your issues" in the bound team, not the team's whole board. */
export function FolderTasksSection({
  projectId,
  binding,
  onBindingChanged,
}: {
  projectId: string
  binding: LinearBinding
  onBindingChanged: () => void
}) {
  const [bindOpen, setBindOpen] = useState(false)
  const { issues, syncing, error, loadCached, syncNow } = useLinearIssues()

  useEffect(() => {
    void loadCached()
  }, [loadCached])

  const scoped = issues.filter(
    (i) =>
      i.team.id === binding.teamId &&
      (!binding.projectId || i.project?.id === binding.projectId)
  )

  const [peekId, setPeekId] = useState<string | null>(null)
  const peekIssue = scoped.find((i) => i.id === peekId) ?? null

  const [send, setSend] = useState<{
    issue: LinearIssue
    comments: LinearComment[]
  } | null>(null)

  return (
    <section className="flex flex-col gap-3">
      <IssueList
        issues={scoped}
        syncing={syncing}
        error={error}
        emptyMessage="No issues assigned to you in this team."
        onSelect={(issue) => setPeekId(issue.id)}
        scroll={false}
        leading={
          <span className="flex items-center gap-2">
            <h2 className="font-semibold text-base text-foreground">Tasks</h2>
            <CountChip>{scoped.length}</CountChip>
          </span>
        }
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
        onBound={onBindingChanged}
      />
    </section>
  )
}
