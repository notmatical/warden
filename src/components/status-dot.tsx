import type { EffectiveStatus } from "@/lib/session-status"
import { cn } from "@/lib/utils"

const STATUS_STYLES: Record<EffectiveStatus, string> = {
  idle: "bg-muted-foreground/60",
  running: "bg-amber-500",
  needsInput: "bg-violet-500",
  error: "bg-destructive",
}

const STATUS_LABEL: Record<EffectiveStatus, string> = {
  idle: "Idle",
  running: "Running",
  needsInput: "Needs you",
  error: "Error",
}

/** Colors for the attention-grabbing ping ring, for the statuses that get one. */
const STATUS_PING: Partial<Record<EffectiveStatus, string>> = {
  running: "bg-amber-500/70",
  needsInput: "bg-violet-500/70",
}

export function StatusDot({
  status,
  className,
}: {
  status: EffectiveStatus
  className?: string
}) {
  return (
    <span
      className={cn("relative inline-flex size-2 shrink-0", className)}
      role="status"
      aria-label={STATUS_LABEL[status]}
      title={STATUS_LABEL[status]}
    >
      {STATUS_PING[status] && (
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full",
            STATUS_PING[status]
          )}
        />
      )}
      <span
        className={cn(
          "relative inline-flex size-2 rounded-full",
          STATUS_STYLES[status]
        )}
      />
    </span>
  )
}
