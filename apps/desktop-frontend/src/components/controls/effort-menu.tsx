import { Check, ChevronDown, Gauge } from "lucide-react"
import { useEffect } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { useControllableOpen } from "@/hooks/use-controllable-open"
import { effortLabel, effortOptionsFor } from "@/lib/models"
import { cn } from "@/lib/utils"
import type { Backend, EffortLevel } from "@/types"

/** Cool → hot, signaling increasing reasoning effort; ultracode goes beyond
 *  the scale (effort plus workflow orchestration). */
const EFFORT_COLOR: Record<EffortLevel, string> = {
  low: "text-slate-400",
  medium: "text-sky-500",
  high: "text-emerald-500",
  xhigh: "text-amber-500",
  max: "text-red-500",
  ultracode: "text-fuchsia-500",
}

interface EffortMenuProps {
  value: EffortLevel
  onChange: (effort: EffortLevel) => void
  /** Backend the session runs on; Ultracode is offered for Claude only. */
  backend?: Backend
  disabled?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** "toolbar" (default): compact ghost trigger, for the composer. "form":
   *  full-width field-style trigger, for dialogs and the workflow node. */
  variant?: "toolbar" | "form"
}

export function EffortMenu({
  value,
  onChange,
  backend,
  disabled,
  open: controlledOpen,
  onOpenChange,
  variant = "toolbar",
}: EffortMenuProps) {
  const [open, setOpen] = useControllableOpen(controlledOpen, onOpenChange)
  const options = effortOptionsFor(backend)

  // While the menu is open, the bare number keys pick a level directly.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const index = Number(event.key) - 1
      if (!Number.isInteger(index) || index < 0 || index >= options.length) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      onChange(options[index].value)
      setOpen(false)
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [open, onChange, setOpen, options])

  // Backends without a reasoning-effort control (Cursor) render nothing.
  if (options.length === 0) return null

  const trigger =
    variant === "form" ? (
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className="h-9 w-full justify-between gap-2 border-input bg-transparent px-3 font-normal hover:bg-input/30 dark:bg-input/30 dark:hover:bg-input/50"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Gauge className={cn("size-3.5 shrink-0", EFFORT_COLOR[value])} />
            <span className="truncate text-sm">{effortLabel(value)}</span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/60" />
        </Button>
      </DropdownMenuTrigger>
    ) : (
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="h-7 gap-1.5 px-2.5 text-xs font-medium text-foreground/80 hover:text-foreground"
        >
          <Gauge className={cn("size-3.5", EFFORT_COLOR[value])} />
          {effortLabel(value)}
          <ChevronDown className="size-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
    )

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={variant === "form"}>
      {trigger}
      <DropdownMenuContent align="start" className="w-44">
        {options.map((option, index) => {
          const selected = value === option.value
          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => onChange(option.value)}
              className="gap-2"
            >
              <Check
                className={cn(
                  "size-4 shrink-0",
                  selected ? "opacity-100" : "opacity-0"
                )}
              />
              <Gauge
                className={cn("size-4 shrink-0", EFFORT_COLOR[option.value])}
              />
              <span className="text-sm">{option.label}</span>
              <Kbd className="ml-auto">{index + 1}</Kbd>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
