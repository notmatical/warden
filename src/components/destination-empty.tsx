import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

/** Centered empty/placeholder state for a primary destination pane. */
export function DestinationEmpty({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-muted/50 text-muted-foreground">
        <Icon className="size-6" />
      </div>
      <div className="space-y-1">
        <h2 className="font-medium text-foreground text-sm">{title}</h2>
        <p className="max-w-xs text-muted-foreground text-xs">{description}</p>
      </div>
      {action}
    </div>
  )
}
