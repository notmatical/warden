import { Slot } from "radix-ui"
import type * as React from "react"

import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

// Borderless "inferred" table: a card shell with hairline-divided rows. Columns
// line up because every row (and the optional header) is passed the same CSS
// grid template. `asChild`/`onClick` make a row interactive (hover + cursor).

interface DataTableProps extends React.ComponentProps<"div"> {
  /** Drop the ring shell when nesting inside a card that already has one. */
  ringless?: boolean
}

export function DataTable({
  children,
  className,
  ringless,
  ...props
}: DataTableProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs",
        !ringless && "ring-1 ring-foreground/10",
        className
      )}
      data-slot="data-table"
      {...props}
    >
      <div className="flex flex-col">{children}</div>
    </div>
  )
}

export function DataTableHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "border-foreground/5 border-b bg-foreground/[0.02] px-4 py-2.5 font-semibold text-[10px] text-muted-foreground uppercase tracking-[0.16em]",
        className
      )}
      data-slot="data-table-header"
      {...props}
    />
  )
}

interface DataTableRowProps extends React.ComponentProps<"div"> {
  asChild?: boolean
  selected?: boolean
}

export function DataTableRow({
  asChild,
  className,
  selected,
  ...props
}: DataTableRowProps) {
  const Comp = asChild ? Slot.Root : "div"
  return (
    <Comp
      className={cn(
        "group border-foreground/5 border-b px-4 py-2.5 transition-colors last:border-b-0",
        (asChild || props.onClick) && "cursor-pointer hover:bg-accent/60",
        selected && "bg-foreground/[0.04]",
        className
      )}
      data-selected={selected || undefined}
      data-slot="data-table-row"
      {...props}
    />
  )
}

export function DataTableEmpty({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "px-4 py-12 text-center text-muted-foreground text-sm",
        className
      )}
      data-slot="data-table-empty"
    >
      {children}
    </div>
  )
}

export function DataTableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          className="flex items-center gap-4 border-foreground/5 border-b px-4 py-2.5 last:border-b-0"
          // biome-ignore lint/suspicious/noArrayIndexKey: pure skeleton, indices are stable
          key={i}
        >
          <Skeleton className="size-8 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-5 w-20 rounded-md" />
        </div>
      ))}
    </div>
  )
}
