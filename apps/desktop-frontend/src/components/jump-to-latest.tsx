import { ArrowDown } from "lucide-react"

import { cn } from "@/lib/utils"

/** Floating "jump to latest" pill, shown when the transcript is scrolled up off
 *  the bottom. Pulses a dot while new output is streaming below the fold. */
export function JumpToLatest({
  visible,
  active,
  onClick,
  className,
}: {
  visible: boolean
  /** New content is streaming in below the fold — show the activity pulse. */
  active?: boolean
  onClick: () => void
  className?: string
}) {
  if (!visible) return null
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-popover/90 px-3 text-xs text-muted-foreground shadow-md backdrop-blur transition-colors hover:text-foreground",
        className
      )}
    >
      <ArrowDown className="size-3.5" />
      <span>Jump to latest</span>
      {active ? (
        <span aria-hidden className="absolute -top-0.5 -right-0.5 flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-500/70" />
          <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
        </span>
      ) : null}
    </button>
  )
}
