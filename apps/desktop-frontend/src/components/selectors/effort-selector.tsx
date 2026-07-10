import { Button } from "@warden/ui/components/button"
import {
  Popover,
  PopoverPrimitive,
  PopoverTrigger,
} from "@warden/ui/components/popover"
import {
  Tooltip,
  TooltipPopup,
  TooltipProvider,
  TooltipTrigger,
} from "@warden/ui/components/tooltip"
import { Check, ChevronDown, Gauge } from "lucide-react"
import { useEffect } from "react"

import { Kbd } from "@/components/ui/kbd"
import { useControllableOpen } from "@/hooks/use-controllable-open"
import { effortLabel, effortOptionsFor } from "@/lib/models"
import { cn } from "@/lib/utils"
import type { Backend, EffortLevel } from "@/types"

/** Cool to hot, signaling increasing reasoning effort; ultracode goes beyond the
 *  scale (effort plus workflow orchestration). */
const EFFORT_COLOR: Record<EffortLevel, string> = {
  low: "text-slate-400",
  medium: "text-sky-500",
  high: "text-emerald-500",
  xhigh: "text-amber-500",
  max: "text-red-500",
  ultracode: "text-fuchsia-500",
}

interface EffortSelectorProps {
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

/**
 * Reasoning-effort picker, rebuilt on @warden/ui to match the model and mode
 * selectors. While open, the bare number keys pick a level directly.
 */
export function EffortSelector({
  value,
  onChange,
  backend,
  disabled,
  open: controlledOpen,
  onOpenChange,
  variant = "toolbar",
}: EffortSelectorProps) {
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

  const triggerButton =
    variant === "form" ? (
      <Button
        variant="outline"
        disabled={disabled}
        className="h-9 w-full justify-between gap-2 px-3 font-normal"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Gauge className={cn("size-3.5 shrink-0", EFFORT_COLOR[value])} />
          <span className="truncate text-sm">{effortLabel(value)}</span>
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/60" />
      </Button>
    ) : (
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        className="h-7 gap-1.5 px-2.5 font-medium text-foreground/80 text-xs hover:text-foreground"
      >
        <Gauge className={cn("size-3.5", EFFORT_COLOR[value])} />
        {effortLabel(value)}
        <ChevronDown className="size-3 opacity-50" />
      </Button>
    )

  return (
    <TooltipProvider>
      <Popover open={open} onOpenChange={setOpen}>
        {variant === "toolbar" ? (
          <Tooltip>
            <TooltipTrigger
              render={<PopoverTrigger render={triggerButton} />}
            />
            <TooltipPopup side="top" className="w-fit whitespace-nowrap">
              Effort
            </TooltipPopup>
          </Tooltip>
        ) : (
          <PopoverTrigger render={triggerButton} />
        )}

        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Positioner
            align="start"
            side="top"
            sideOffset={6}
            className="z-50 transition-[top,left,right,bottom,transform] data-instant:transition-none"
          >
            <PopoverPrimitive.Popup
              className={cn(
                "relative flex origin-(--transform-origin) flex-col overflow-hidden rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg/8 outline-none transition-[transform,opacity] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
                "w-48",
                variant === "form" && "min-w-[var(--anchor-width)]"
              )}
            >
              {options.map((option, index) => {
                const selected = value === option.value
                return (
                  <div
                    key={option.value}
                    role="button"
                    tabIndex={0}
                    onClick={() => onChange(option.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        onChange(option.value)
                      }
                    }}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none transition-colors",
                      selected ? "bg-accent" : "hover:bg-accent/50"
                    )}
                  >
                    <Gauge
                      className={cn(
                        "size-4 shrink-0",
                        EFFORT_COLOR[option.value]
                      )}
                    />
                    <span className="flex-1 truncate">{option.label}</span>
                    {selected ? (
                      <Check className="size-4 shrink-0 text-primary" />
                    ) : (
                      <Kbd>{index + 1}</Kbd>
                    )}
                  </div>
                )
              })}
            </PopoverPrimitive.Popup>
          </PopoverPrimitive.Positioner>
        </PopoverPrimitive.Portal>
      </Popover>
    </TooltipProvider>
  )
}
