import {
  Check,
  CircleSlash,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Loader2,
  X,
} from "lucide-react"

import { cn } from "@/lib/utils"
import type { PrCheckCounts } from "@/types"

export const PR_PILL =
  "inline-flex w-fit items-center rounded-lg px-1.5 py-px font-medium text-[10px] ring-1 ring-inset"

/** The PR glyph tinted by state: draft muted, merged violet, closed red,
 *  open emerald. */
export function PrStateIcon({
  state,
  isDraft,
  className,
}: {
  state: string | null
  isDraft?: boolean
  className?: string
}) {
  if (state === "MERGED") {
    return <GitMerge className={cn("text-violet-500", className)} />
  }
  if (state === "CLOSED") {
    return <GitPullRequestClosed className={cn("text-red-500", className)} />
  }
  if (isDraft) {
    return (
      <GitPullRequestDraft className={cn("text-muted-foreground", className)} />
    )
  }
  return <GitPullRequest className={cn("text-emerald-500", className)} />
}

export function StateBadge({
  state,
  isDraft,
}: {
  state: string
  isDraft: boolean
}) {
  const [label, tone] = isDraft
    ? ["draft", "bg-muted/60 text-muted-foreground ring-border"]
    : state === "MERGED"
      ? ["merged", "bg-violet-500/10 text-violet-400 ring-violet-500/30"]
      : state === "CLOSED"
        ? ["closed", "bg-red-500/10 text-red-400 ring-red-500/30"]
        : ["open", "bg-emerald-500/10 text-emerald-500 ring-emerald-500/30"]
  return <span className={cn(PR_PILL, tone)}>{label}</span>
}

export function ReviewBadge({
  decision,
  compact,
}: {
  decision: string | null
  /** Shortens "changes requested" to "changes" for tight table cells. */
  compact?: boolean
}) {
  if (decision === "APPROVED") {
    return (
      <span
        className={cn(
          PR_PILL,
          "bg-emerald-500/10 text-emerald-500 ring-emerald-500/30"
        )}
      >
        approved
      </span>
    )
  }
  if (decision === "CHANGES_REQUESTED") {
    return (
      <span
        className={cn(PR_PILL, "bg-red-500/10 text-red-400 ring-red-500/30")}
      >
        {compact ? "changes" : "changes requested"}
      </span>
    )
  }
  if (decision === "REVIEW_REQUIRED") {
    return (
      <span
        className={cn(PR_PILL, "bg-muted/60 text-muted-foreground ring-border")}
      >
        review required
      </span>
    )
  }
  return null
}

/** The one pill worth a table cell: merged/closed state, draft, or an
 *  actionable review decision. Nothing for a plain open PR (the icon
 *  already says open). */
export function PrStatusPill({
  state,
  isDraft,
  reviewDecision,
}: {
  state: string | null
  isDraft: boolean
  reviewDecision: string | null
}) {
  if (state === "MERGED" || state === "CLOSED") {
    return <StateBadge state={state} isDraft={false} />
  }
  if (isDraft) {
    return <StateBadge state={state ?? "OPEN"} isDraft />
  }
  if (reviewDecision === "APPROVED" || reviewDecision === "CHANGES_REQUESTED") {
    return <ReviewBadge decision={reviewDecision} compact />
  }
  return null
}

const COUNT_GROUPS: {
  key: keyof PrCheckCounts
  icon: typeof Check
  tone: string
  spin?: boolean
}[] = [
  { key: "failed", icon: X, tone: "text-red-500" },
  { key: "passed", icon: Check, tone: "text-emerald-500" },
  { key: "pending", icon: Loader2, tone: "text-amber-500", spin: true },
  { key: "skipped", icon: CircleSlash, tone: "text-muted-foreground/60" },
]

/** Per-state CI tallies as compact count+glyph pairs (`2× 120✓ 3⟳`),
 *  zero-count groups hidden. */
export function CheckCounts({
  counts,
  className,
}: {
  counts: PrCheckCounts
  className?: string
}) {
  const groups = COUNT_GROUPS.filter((g) => counts[g.key] > 0)
  if (groups.length === 0) return null
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 font-medium text-[11px] tabular-nums",
        className
      )}
    >
      {groups.map(({ key, icon: Icon, tone, spin }) => (
        <span
          key={key}
          role="img"
          aria-label={`${counts[key]} checks ${key}`}
          className={cn("flex items-center gap-px", tone)}
        >
          {counts[key]}
          <Icon className={cn("size-3", spin && "animate-spin")} />
        </span>
      ))}
    </span>
  )
}
