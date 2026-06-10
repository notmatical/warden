import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/** Small count chip used next to section and page titles. */
export function CountChip({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "rounded-md bg-muted/60 px-1.5 py-0.5 font-medium text-[11px] text-muted-foreground tabular-nums",
        className
      )}
    >
      {children}
    </span>
  )
}
