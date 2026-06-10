import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/** A full-pane state for failures (and other terminal states): icon, title,
 *  plain-English description, an optional monospace detail box for raw output,
 *  and an actions row. The same shape Superset uses for workspace errors. */
export function ErrorState({
  icon: Icon,
  tone = "destructive",
  title,
  description,
  detail,
  actions,
  className,
}: {
  icon: LucideIcon
  /** destructive renders the icon tinted red; muted for neutral states. */
  tone?: "destructive" | "muted"
  title: string
  description?: ReactNode
  /** Raw error/command output, shown selectable in a monospace box. */
  detail?: string | null
  actions?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 items-center justify-center overflow-y-auto p-6",
        className
      )}
    >
      <div className="flex w-full max-w-lg flex-col items-center gap-3 text-center">
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-lg",
            tone === "destructive"
              ? "bg-destructive/10 text-destructive"
              : "bg-muted text-muted-foreground"
          )}
        >
          <Icon className="size-5" />
        </div>
        <div className="space-y-1">
          <h2 className="text-[15px] font-medium">{title}</h2>
          {description ? (
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {detail ? (
          <pre
            className={cn(
              "max-h-56 w-full cursor-text select-text overflow-auto rounded-md border p-3 text-left font-mono text-[11px] leading-relaxed whitespace-pre-wrap",
              tone === "destructive"
                ? "border-destructive/20 bg-destructive/[0.04] text-foreground/90"
                : "border-border/60 bg-muted/30 text-muted-foreground"
            )}
          >
            {detail}
          </pre>
        ) : null}
        {actions ? (
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  )
}
