import { SendToAgentDialogCore } from "@/components/common/send-to-agent-dialog"
import { issueBranchName } from "@/lib/branch"

import { buildGithubIssuePrompt } from "../prompt"
import type { GhIssueComment, RepoIssue } from "../types"

/** GitHub flavor of the send-to-agent dialog: issue prompt as the first
 *  message, with the issue's own repo preselected. */
export function SendGithubIssueDialog({
  issue,
  comments,
  open,
  onOpenChange,
  onSent,
}: {
  issue: RepoIssue | null
  comments: GhIssueComment[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSent?: () => void
}) {
  if (!issue) return null

  return (
    <SendToAgentDialogCore
      identifier={`#${issue.number}`}
      open={open}
      onOpenChange={onOpenChange}
      buildTitle={() => `#${issue.number}: ${issue.title}`}
      buildFirstMessage={() => buildGithubIssuePrompt(issue, comments)}
      branchHint={issueBranchName(issue.number, issue.title)}
      defaultProjectId={issue.projectId}
      onSent={() => onSent?.()}
    />
  )
}
