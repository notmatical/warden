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
}

export function EffortMenu({
  value,
  onChange,
  backend,
  disabled,
  open: controlledOpen,
  onOpenChange,
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

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
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
