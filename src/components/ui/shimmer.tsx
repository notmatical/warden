import type { CSSProperties, ElementType } from "react"

import { cn } from "@/lib/utils"

interface ShimmerProps {
  children: string
  as?: ElementType
  className?: string
  /** Width of the bright sweep band, in px per character (scales with length). */
  spread?: number
}

/** Text with a bright band that sweeps across dim base text — a subtle "thinking"
 *  affordance. Pure CSS (`text-shimmer` in animation.css); honors reduced motion. */
export function Shimmer({
  children,
  as: Comp = "span",
  className,
  spread = 2,
}: ShimmerProps) {
  return (
    <Comp
      className={cn("text-shimmer", className)}
      style={
        { "--shimmer-spread": `${children.length * spread}px` } as CSSProperties
      }
    >
      {children}
    </Comp>
  )
}

/** Shimmer the label only while `active`; otherwise render plain (same layout). */
export function ShimmerLabel({
  children,
  active = true,
  className,
  spread,
}: {
  children: string
  active?: boolean
  className?: string
  spread?: number
}) {
  return active ? (
    <Shimmer className={className} spread={spread}>
      {children}
    </Shimmer>
  ) : (
    <span className={cn("shrink-0 whitespace-nowrap", className)}>
      {children}
    </span>
  )
}
