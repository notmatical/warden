import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export interface SegmentedTabItem<T extends string> {
  id: T
  label: string
  icon?: LucideIcon
}

/** Segmented tab control: a muted track with the active segment cut out as a
 *  raised pill — the app's soft-rounded look. `children` render right-aligned
 *  (counts, save indicators, refresh buttons). */
export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  children,
}: {
  tabs: readonly SegmentedTabItem<T>[]
  value: T
  onChange: (id: T) => void
  className?: string
  children?: ReactNode
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex w-fit items-center gap-0.5 rounded-lg bg-muted/50 p-0.5">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1 text-[13px] font-medium transition-colors",
              value === id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {Icon ? <Icon className="size-3.5" /> : null}
            {label}
          </button>
        ))}
      </div>
      {children ? (
        <div className="ml-auto flex items-center gap-2">{children}</div>
      ) : null}
    </div>
  )
}
