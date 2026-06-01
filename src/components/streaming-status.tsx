import { Loader2 } from "lucide-react"

import { useElapsedTime } from "@/hooks/use-elapsed-time"
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
  const running = useAppStore((s) => s.sessions[sessionId]?.status === "running")
  const mode = useAppStore((s) => s.sessions[sessionId]?.permissionMode)
  const startedAt = useAppStore((s) => s.startedAtBySession[sessionId] ?? null)
  const elapsed = useElapsedTime(running ? startedAt : null)

  if (!running) return null

  return (
    <div className="inline-flex items-center gap-2 text-xs text-muted-foreground select-none">
      <Loader2 className="size-3.5 animate-spin" />
      <span>{(mode && WORK_LABEL[mode]) || "Working"}</span>
      {elapsed && (
        <span className="font-mono tabular-nums text-muted-foreground/60">
          {elapsed}
        </span>
      )}
    </div>
  )
}
