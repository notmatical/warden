import { useMemo } from "react"

import { BrailleSpinner } from "@/components/ui/braille-spinner"
import { Shimmer } from "@/components/ui/shimmer"
import { useElapsedTime } from "@/hooks/use-elapsed-time"
import { hasPendingQuestion } from "@/lib/agent-tools"
import { useAppStore } from "@/store/app-store"
import type { PermissionMode } from "@/types"

/** What the agent is doing, by permission posture. */
const WORK_LABEL: Record<PermissionMode, string> = {
  plan: "Planning",
  acceptEdits: "Editing",
  bypassPermissions: "Working",
  default: "Working",
}

/** Live "agent is working" indicator: a spinner, a mode-aware label, and the
 *  elapsed time. Renders only while the session has a turn in flight. */
export function StreamingStatus({ sessionId }: { sessionId: string }) {
  const running = useAppStore(
    (s) => s.sessions[sessionId]?.status === "running"
  )
  const mode = useAppStore((s) => s.sessions[sessionId]?.permissionMode)
  const startedAt = useAppStore((s) => s.startedAtBySession[sessionId] ?? null)
  // The agent can keep streaming after an AskUserQuestion; while it's really
  // waiting on the user, hide the indicator (the status stays "running").
  const events = useAppStore((s) => s.eventsBySession[sessionId])
  const waitingOnUser = useMemo(() => hasPendingQuestion(events), [events])
  const active = running && !waitingOnUser
  const elapsed = useElapsedTime(active ? startedAt : null)

  if (!active) return null

  return (
    <div className="inline-flex items-center gap-2 text-xs text-muted-foreground select-none">
      <BrailleSpinner className="text-sm" />
      <Shimmer>{(mode && WORK_LABEL[mode]) || "Working"}</Shimmer>
      {elapsed && (
        <span className="font-mono tabular-nums text-muted-foreground/60">
          {elapsed}
        </span>
      )}
    </div>
  )
}
