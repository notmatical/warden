import { cn } from "@/lib/utils"
import type { NodeRunStatus, RunStatus } from "@/types/workflow"

// Shared run/node status language for the workflow editor: a tinted pill (fill
// + ring) and a dot color, so the canvas, node cards, and history all read the
// same. Covers both run statuses and per-node statuses.
export const STATUS_PILL: Record<
  RunStatus | NodeRunStatus,
  { label: string; dot: string; pill: string }
> = {
  pending: {
    label: "Pending",
    dot: "bg-muted-foreground/40",
    pill: "bg-muted/60 text-muted-foreground ring-border",
  },
  running: {
    label: "Running",
    dot: "bg-blue-500",
    pill: "bg-blue-500/10 text-blue-400 ring-blue-500/30",
  },
  done: {
    label: "Done",
    dot: "bg-emerald-500",
    pill: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/30",
  },
  completed: {
    label: "Done",
    dot: "bg-emerald-500",
    pill: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/30",
  },
  failed: {
    label: "Failed",
    dot: "bg-red-500",
    pill: "bg-red-500/10 text-red-400 ring-red-500/30",
  },
  paused: {
    label: "Paused",
    dot: "bg-amber-500",
    pill: "bg-amber-500/10 text-amber-400 ring-amber-500/30",
  },
  awaitingInput: {
    label: "Needs input",
    dot: "bg-amber-500",
    pill: "bg-amber-500/10 text-amber-400 ring-amber-500/30",
  },
  skipped: {
    label: "Skipped",
    dot: "bg-muted-foreground/40",
    pill: "bg-muted/50 text-muted-foreground ring-border",
  },
  canceled: {
    label: "Canceled",
    dot: "bg-muted-foreground/40",
    pill: "bg-muted/50 text-muted-foreground ring-border",
  },
}

export function StatusPill({
  status,
  pulse,
}: {
  status: RunStatus | NodeRunStatus
  pulse?: boolean
}) {
  const s = STATUS_PILL[status]
  return (
    <span
      className={cn(
        "flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 font-medium text-[11px] shadow-sm ring-1 ring-inset backdrop-blur",
        s.pill
      )}
    >
      <span
        className={cn("size-1.5 rounded-full", s.dot, pulse && "animate-pulse")}
      />
      {s.label}
    </span>
  )
}
