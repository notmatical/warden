import { ChevronDown } from "lucide-react"
import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

/** Filter-bar control surface — one look for every destination's filter row. */
export const FILTER_SURFACE = "border-border/60 bg-input/50 dark:bg-input/50"

export interface FilterOption {
  value: string
  label: string
  /** Small leading visual in the menu item (status glyph, color dot…). */
  swatch?: ReactNode
}

/** Multi-select filter dropdown: trigger shows an optional icon stack, the
 *  label, and a count badge once anything is selected. Empty selection means
 *  "no filter". Hidden entirely when there is nothing to filter by. */
export function FilterMenu({
  label,
  options,
  selected,
  onToggle,
  onClear,
  icon,
}: {
  label: string
  options: FilterOption[]
  selected: Set<string>
  onToggle: (value: string, on: boolean) => void
  onClear: () => void
  /** Leading visual in the trigger, e.g. stacked status glyphs. */
  icon?: ReactNode
}) {
  if (options.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className={cn(
            "h-8 gap-1.5 hover:bg-input/70 dark:hover:bg-input/70",
            FILTER_SURFACE
          )}
        >
          {icon}
          {label}
          {selected.size > 0 ? (
            <Badge
              variant="secondary"
              className="h-[18px] justify-center rounded-[5px] px-1 font-mono text-[10px] tabular-nums"
            >
              {selected.size}
            </Badge>
          ) : null}
          <ChevronDown className="size-3.5 text-muted-foreground/60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-72 w-52 overflow-y-auto"
      >
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={selected.has(o.value)}
            onCheckedChange={(c) => onToggle(o.value, c === true)}
            onSelect={(e) => e.preventDefault()}
            className="gap-2 text-[13px]"
          >
            {o.swatch}
            <span className="truncate">{o.label}</span>
          </DropdownMenuCheckboxItem>
        ))}
        {selected.size > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => onClear()}
              className="text-[13px] text-muted-foreground"
            >
              Clear
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Up to three filter swatches overlapped into one compact stack, for use as a
 *  FilterMenu trigger icon. */
export function SwatchStack({ swatches }: { swatches: ReactNode[] }) {
  return (
    <span className="flex items-center">
      {swatches.slice(0, 3).map((swatch, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: purely visual stack, order is the identity
          key={i}
          className={cn(
            "flex items-center justify-center rounded-full ring-1 ring-background",
            i > 0 && "-ml-1.5"
          )}
        >
          {swatch}
        </span>
      ))}
    </span>
  )
}
