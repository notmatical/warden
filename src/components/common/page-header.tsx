import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

interface PageHeaderProps {
  icon: LucideIcon
  title: string
  /** Small count chip after the title (e.g. item count). */
  count?: number | string
  /** Muted secondary text after the title (e.g. a path). */
  subtitle?: string
  /** Right-aligned controls: buttons, menus, filters. */
  actions?: ReactNode
  /** Optional second row beneath the title (e.g. a filter bar). */
  children?: ReactNode
  className?: string
}

/** The standard destination header: a leading glyph, title, optional count /
 *  subtitle, and right-aligned actions, divided from the body by a hairline.
 *  One convention shared across pages — keep new destinations on it. */
export function PageHeader({
  icon: Icon,
  title,
  count,
  subtitle,
  actions,
  children,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-3 border-foreground/5 border-b px-6 py-3.5",
        className
      )}
    >
      <div className="flex items-center gap-2.5">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <h1 className="font-medium text-foreground text-sm">{title}</h1>
        {count !== undefined ? (
          <span className="rounded-md bg-muted/60 px-1.5 py-0.5 font-medium text-[11px] text-muted-foreground tabular-nums">
            {count}
          </span>
        ) : null}
        {subtitle ? (
          <span className="truncate font-mono text-[11px] text-muted-foreground/70">
            {subtitle}
          </span>
        ) : null}
        {actions ? (
          <div className="ml-auto flex items-center gap-1">{actions}</div>
        ) : null}
      </div>
      {children}
    </div>
  )
}
