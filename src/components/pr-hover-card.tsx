import { openUrl } from "@tauri-apps/plugin-opener"
import { Check, Loader2, Minus, X } from "lucide-react"
import { type ReactNode, useRef, useState } from "react"

import { ReviewBadge, StateBadge } from "@/components/common/pr-badges"
import { GitHubIcon } from "@/components/icons/brand"
import { Button } from "@/components/ui/button"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import * as ipc from "@/lib/ipc"
import { formatDuration, relativeTime } from "@/lib/time"
import { cn } from "@/lib/utils"
import type { PrCheck, PrCheckState, PrDetails } from "@/types"

const CHECK_ICON: Record<
  PrCheckState,
  { icon: typeof Check; className: string }
> = {
  success: { icon: Check, className: "text-emerald-500" },
  failure: { icon: X, className: "text-red-500" },
  pending: { icon: Loader2, className: "animate-spin text-amber-500" },
  skipped: { icon: Minus, className: "text-muted-foreground/60" },
  cancelled: { icon: Minus, className: "text-muted-foreground/60" },
}

function CheckRow({ check }: { check: PrCheck }) {
  const { icon: Icon, className } = CHECK_ICON[check.state]
  const duration =
    check.startedAt && check.completedAt
      ? formatDuration(check.startedAt, check.completedAt)
      : null
  const inner = (
    <>
      <Icon className={cn("size-3 shrink-0", className)} />
      <span className="min-w-0 flex-1 truncate text-left">{check.name}</span>
      {duration ? (
        <span className="shrink-0 text-[10px] text-muted-foreground/60 tabular-nums">
          {duration}
        </span>
      ) : null}
    </>
  )
  if (!check.url) {
    return (
      <div className="flex items-center gap-1.5 py-0.5 text-muted-foreground text-xs">
        {inner}
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={() => check.url && void openUrl(check.url)}
      className="flex w-full items-center gap-1.5 rounded px-0.5 py-0.5 text-muted-foreground text-xs transition-colors hover:bg-muted/60 hover:text-foreground"
    >
      {inner}
    </button>
  )
}

function Details({ pr }: { pr: PrDetails }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="font-medium text-muted-foreground text-xs tabular-nums">
            #{pr.number}
          </span>
          <StateBadge state={pr.state} isDraft={pr.isDraft} />
          {pr.state === "OPEN" ? (
            <ReviewBadge decision={pr.reviewDecision} />
          ) : null}
        </div>
        <span className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums">
          <span className="text-emerald-500">+{pr.additions}</span>
          <span className="text-red-500">−{pr.deletions}</span>
        </span>
      </div>

      <p className="line-clamp-2 text-foreground text-xs leading-relaxed">
        {pr.title}
      </p>

      {pr.updatedAt ? (
        <span className="text-[11px] text-muted-foreground/70">
          Updated {relativeTime(pr.updatedAt)}
        </span>
      ) : null}

      {pr.checks.length > 0 ? (
        <div className="-mx-0.5 flex max-h-44 flex-col gap-px overflow-y-auto border-border/70 border-t pt-2">
          {pr.checks.map((check) => (
            <CheckRow
              key={`${check.name}:${check.url ?? check.startedAt ?? ""}`}
              check={check}
            />
          ))}
        </div>
      ) : null}

      <Button
        variant="secondary"
        size="xs"
        onClick={() => void openUrl(pr.url)}
        className="mt-0.5 w-full gap-1.5"
      >
        <GitHubIcon className="size-3.5" />
        View on GitHub
      </Button>
    </div>
  )
}

/** Wraps a PR chip/cell: hovering fetches the PR's live state from gh and
 *  shows review status, diff stats, and per-check CI rows. */
export function PrHoverCard({
  sessionId,
  children,
}: {
  sessionId: string
  children: ReactNode
}) {
  const [details, setDetails] = useState<PrDetails | null>(null)
  const inflight = useRef(false)

  // Refetch on every hover (CI moves fast) but keep showing the previous
  // snapshot while the refresh is in flight.
  const load = () => {
    if (inflight.current) return
    inflight.current = true
    ipc
      .prDetails(sessionId)
      .then((d) => {
        if (d) setDetails(d)
      })
      .catch(() => {})
      .finally(() => {
        inflight.current = false
      })
  }

  // No placeholder UI: the card only exists once there's something to show.
  // The first hover fetches; the card pops in as soon as the data lands.
  return (
    <HoverCard openDelay={200} closeDelay={120}>
      <HoverCardTrigger asChild onPointerEnter={load}>
        {children}
      </HoverCardTrigger>
      {details ? (
        <HoverCardContent side="top" align="end" className="w-80 p-3">
          <Details pr={details} />
        </HoverCardContent>
      ) : null}
    </HoverCard>
  )
}
