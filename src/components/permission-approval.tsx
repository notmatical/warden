import { useState } from "react"
import { Check, ChevronRight, ShieldAlert, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"
import type { ToolDenial } from "@/types"

/** Compact approval bar shown above the composer when a turn stopped on denied
 *  tool calls. Approving allowlists the patterns and resumes; rejecting just
 *  dismisses (the turn already ended). The commands are collapsed by default. */
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
  const reject = () => resolveApproval(sessionId, eventId)

  return (
    <div className="mb-1.5 overflow-hidden rounded-lg border border-amber-500/40 bg-amber-500/5">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ShieldAlert className="size-3.5 shrink-0 text-amber-500" />
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
            Permission needed
          </span>
          <span className="truncate text-[11px] text-muted-foreground">
            {denials.length} command{denials.length === 1 ? "" : "s"}
          </span>
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/60 transition-transform",
              expanded && "rotate-90"
            )}
          />
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" className="h-6 gap-1 px-2 text-xs" onClick={approve}>
            <Check className="size-3" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={reject}
          >
            <X className="size-3" />
            Reject
          </Button>
        </div>
      </div>
      {expanded ? (
        <ul className="space-y-1 border-t border-amber-500/20 px-2.5 py-2">
          {denials.map((denial, i) => (
            <li
              key={i}
              className="rounded bg-muted/60 px-2 py-1 font-mono text-xs break-all text-muted-foreground"
            >
              {denial.pattern}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
