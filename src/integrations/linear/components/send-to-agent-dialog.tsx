import { useState } from "react"
import { toast } from "sonner"

import { SendToAgentDialogCore } from "@/components/common/send-to-agent-dialog"
import { Switch } from "@/components/ui/switch"
import { useAppStore } from "@/store/app-store"

import { linearBindings, linearStartIssue } from "../ipc"
import { buildIssuePrompt } from "../prompt"
import type { LinearComment, LinearIssue } from "../types"

/** Linear flavor of the send-to-agent dialog: issue prompt as the first
 *  message, binding-based folder preselection, originating-issue link for PR
 *  writeback, and an opt-out "Move to In Progress" transition. */
export function SendToAgentDialog({
  issue,
  comments,
  open,
  onOpenChange,
  defaultProjectId,
  onSent,
}: {
  issue: LinearIssue | null
  comments: LinearComment[]
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultProjectId?: string
  onSent?: () => void
}) {
  const [startIssue, setStartIssue] = useState(true)
  const rootsByGroup = useAppStore((s) => s.rootsByGroup)

  if (!issue) return null

  const knownRoots = new Set(
    Object.values(rootsByGroup)
      .flat()
      .map((root) => root.id)
  )

  // Only unstarted issues can sensibly move to "started".
  const canStart =
    issue.state.type === "backlog" || issue.state.type === "unstarted"

  // Prefer a known repo bound to the issue's project, then its team.
  const preselect = async (): Promise<string | null> => {
    const bound = (await linearBindings()).filter((b) =>
      knownRoots.has(b.projectId)
    )
    const match =
      bound.find(
        (b) =>
          b.binding.projectId != null &&
          b.binding.projectId === issue.project?.id
      ) ?? bound.find((b) => b.binding.teamId === issue.team.id)
    return match?.projectId ?? null
  }

  return (
    <SendToAgentDialogCore
      identifier={issue.identifier}
      open={open}
      onOpenChange={onOpenChange}
      buildTitle={() => `${issue.identifier}: ${issue.title}`}
      buildFirstMessage={() => buildIssuePrompt(issue, comments)}
      preselectProjectId={preselect}
      defaultProjectId={defaultProjectId}
      createOverrides={{ linearIssueId: issue.id }}
      onSent={() => {
        if (canStart && startIssue) {
          void linearStartIssue(issue.id, issue.team.id).catch(() =>
            toast.warning("Couldn't move the issue to In Progress")
          )
        }
        onSent?.()
      }}
    >
      {canStart ? (
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="send-start-issue" className="flex flex-col">
            <span className="text-sm">Move to In Progress</span>
            <span className="text-muted-foreground text-xs">
              Transition the issue in Linear when the session starts.
            </span>
          </label>
          <Switch
            id="send-start-issue"
            checked={startIssue}
            onCheckedChange={setStartIssue}
          />
        </div>
      ) : null}
    </SendToAgentDialogCore>
  )
}
