import { openUrl } from "@tauri-apps/plugin-opener"
import { GitBranch, GitPullRequest } from "lucide-react"
import type { ReactNode } from "react"

import { CheckDot } from "@/components/common/check-dot"
import { SessionFavicon } from "@/components/session-favicon"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { formatModelName } from "@/lib/models"
import { relativeTime } from "@/lib/time"
import { cn } from "@/lib/utils"
import type { Session } from "@/types"

const STATUS_DOT: Record<Session["status"], string> = {
  idle: "bg-muted-foreground/40",
  running: "animate-pulse bg-amber-500",
  error: "bg-red-500",
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-[11px] text-muted-foreground/70">
        {label}
      </span>
      <span className="flex min-w-0 items-center justify-end gap-1 truncate text-right text-xs text-foreground/90">
        {children}
      </span>
    </div>
  )
}

/**
 * Wraps a sidebar session row so hovering it surfaces the session's branch, PR
 * (with CI rollup), model, and last-updated time — the detail the truncated row
 * can't show. Opens on deliberate hover only, so it stays out of the way during
 * scanning and drag-to-pane.
 */
export function SessionHoverCard({
  session,
  children,
}: {
  session: Session
  children: ReactNode
}) {
  const prTone =
    session.prState === "MERGED"
      ? "text-violet-500"
      : session.prState === "CLOSED"
        ? "text-red-500"
        : "text-emerald-500"

  return (
    <HoverCard openDelay={600} closeDelay={100}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={12}
        className="w-64 space-y-2.5 rounded-2xl p-3"
      >
        <div className="flex items-center gap-2">
          <SessionFavicon
            kind={session.kind}
            backend={session.backend}
            status={session.status}
            terminalCommand={session.terminalCommand}
          />
          <span className="min-w-0 flex-1 truncate font-medium text-sm">
            {session.title}
          </span>
          <span
            role="img"
            aria-label={session.status}
            className={cn(
              "size-2 shrink-0 rounded-full",
              STATUS_DOT[session.status]
            )}
          />
        </div>

        <div className="space-y-1 border-border/50 border-t pt-2">
          {session.branch ? (
            <Row label="Branch">
              <GitBranch className="size-3 shrink-0 opacity-60" />
              <span className="truncate">{session.branch}</span>
            </Row>
          ) : null}

          {session.prNumber ? (
            <Row label="Pull request">
              <button
                type="button"
                onClick={() => session.prUrl && void openUrl(session.prUrl)}
                disabled={!session.prUrl}
                className="inline-flex items-center gap-1 rounded transition hover:text-foreground disabled:cursor-default"
              >
                <GitPullRequest className={cn("size-3 shrink-0", prTone)} />
                <span className="font-medium">#{session.prNumber}</span>
                <CheckDot
                  status={session.prCheckStatus}
                  className="size-1.5"
                />
              </button>
            </Row>
          ) : null}

          <Row label="Model">
            <span className="truncate">{formatModelName(session.model)}</span>
          </Row>
          <Row label="Updated">{relativeTime(session.updatedAt)}</Row>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
