import { useState } from "react"
import { Check, ShieldAlert, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useAppStore } from "@/store/app-store"
import type { ToolDenial } from "@/types"

/** Shown when a turn stopped on denied tool calls. Approving adds the patterns
 *  to the session allowlist and resumes; `active` is false for historical
 *  requests (already handled, or superseded by later events). */
export function PermissionApproval({
  sessionId,
  denials,
  active,
}: {
  sessionId: string
  denials: ToolDenial[]
  active: boolean
}) {
  const approveTools = useAppStore((s) => s.approveTools)
  const [resolved, setResolved] = useState<null | "approved" | "denied">(null)

  const patterns = denials.map((d) => d.pattern)

  if (!active || resolved) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground/50">
        <ShieldAlert className="size-3" />
        {resolved === "approved"
          ? "Approved"
          : resolved === "denied"
            ? "Denied"
            : "Permission was requested"}
      </div>
    )
  }

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
        <ShieldAlert className="size-4 shrink-0" />
        Permission needed
      </div>
      <ul className="mt-2 space-y-1">
        {denials.map((denial, i) => (
          <li
            key={i}
            className="truncate rounded bg-muted/60 px-2 py-1 font-mono text-xs text-muted-foreground"
            title={denial.pattern}
          >
            {denial.pattern}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          className="h-7"
          onClick={() => {
            setResolved("approved")
            void approveTools(sessionId, patterns)
          }}
        >
          <Check />
          Approve &amp; continue
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-muted-foreground hover:text-foreground"
          onClick={() => setResolved("denied")}
        >
          <X />
          Deny
        </Button>
      </div>
    </div>
  )
}
