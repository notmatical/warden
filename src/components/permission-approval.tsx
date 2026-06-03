import { useState } from "react"
import { ChevronRight, ShieldAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"
import type { ToolDenial } from "@/types"

/** Compact approval bar shown above the composer when a turn stopped on denied
 *  tool calls. Approving allowlists the patterns and resumes; denying just
 *  dismisses (the turn already ended). Commands are collapsed by default. */
export function PermissionApproval({
  sessionId,
  eventId,
  denials,
}: {
  sessionId: string
  eventId: string
  denials: ToolDenial[]
}) {
  const approveTools = useAppStore((s) => s.approveTools)
  const resolveApproval = useAppStore((s) => s.resolveApproval)
  const [expanded, setExpanded] = useState(false)

  const approve = () => {
    resolveApproval(sessionId, eventId)
    void approveTools(
      sessionId,
      denials.map((d) => d.pattern)
    )
  }
  const deny = () => resolveApproval(sessionId, eventId)

  const extra = denials.length - 1

  return (
    <div className="mb-1.5 overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
      <div className="flex items-center gap-2 py-1.5 pr-1.5 pl-2.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={expanded}
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-amber-500">
            <ShieldAlert className="size-3.5" />
          </span>
          <span className="shrink-0 text-xs font-medium text-foreground">
            Permission needed
          </span>
          <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
            {denials[0]?.pattern}
          </code>
          {extra > 0 ? (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">
              +{extra}
            </span>
          ) : null}
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/50 transition-transform",
              expanded && "rotate-90"
            )}
          />
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" className="h-7 px-2.5 text-xs" onClick={approve}>
            Approve
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={deny}
          >
            Deny
          </Button>
        </div>
      </div>
      {expanded ? (
        <ul className="space-y-1 border-t border-border/60 bg-muted/30 px-2.5 py-2">
          {denials.map((denial, i) => (
            <li
              key={i}
              className="rounded-md bg-background/60 px-2 py-1 font-mono text-[11px] break-all text-muted-foreground"
            >
              {denial.pattern}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
