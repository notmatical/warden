import { useMemo } from "react"

import { GitStatusChips } from "@/components/git-status-chips"
import { PermissionApproval } from "@/components/permission-approval"
import { useGitStatus } from "@/hooks/use-git-status"
import { useAppStore } from "@/store/app-store"

/** The chip row above the input card: a live tool-approval request when one is
 *  pending (it takes the slot), otherwise the session's git-status chips. */
export function ComposerStatusRow({ sessionId }: { sessionId: string }) {
  const { statuses, refresh } = useGitStatus(sessionId)

  // A live tool-approval request: the latest event is a permission_request the
  // user hasn't acted on.
  const pendingApproval = useAppStore((s) => {
    const events = s.eventsBySession[sessionId]
    const last = events?.[events.length - 1]
    if (last?.type !== "permission_request") return null
    return s.approvalResolvedBySession[sessionId] === last.id ? null : last
  })
  // ExitPlanMode is approved via the in-transcript plan widget, so drop it from
  // the generic approval bar, otherwise the same denial surfaces twice.
  const approvalDenials = useMemo(
    () =>
      pendingApproval?.denials.filter((d) => d.toolName !== "ExitPlanMode") ??
      [],
    [pendingApproval]
  )

  if (approvalDenials.length > 0 && pendingApproval) {
    return (
      <PermissionApproval
        sessionId={sessionId}
        eventId={pendingApproval.id}
        denials={approvalDenials}
      />
    )
  }
  return (
    <GitStatusChips statuses={statuses} sessionId={sessionId} refresh={refresh} />
  )
}
