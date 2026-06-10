import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export interface UnderlineTabItem<T extends string> {
  id: T
  label: string
  icon?: LucideIcon
}

/** Quiet underline tab bar: text tabs over a hairline rule, the active one
 *  marked by a foreground underline. `children` render right-aligned — counts,
 *  save indicators, refresh buttons. */
export function UnderlineTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  children,
}: {
  tabs: readonly UnderlineTabItem<T>[]
  value: T
  onChange: (id: T) => void
  className?: string
  children?: ReactNode
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 border-b border-border/60",
        className
      )}
    >
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={cn(
            "relative flex h-8 shrink-0 items-center gap-1.5 text-sm font-medium transition-colors",
            value === id
              ? "text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {Icon ? <Icon className="size-3.5" /> : null}
          {label}
        </button>
      ))}
      {children ? (
        <div className="ml-auto flex items-center gap-2">{children}</div>
      ) : null}
    </div>
  )
}
