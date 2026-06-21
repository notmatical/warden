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
import {
  Check,
  ChevronDown,
  ClipboardList,
  Pencil,
  ShieldOff,
} from "lucide-react"

import { Shortcut } from "@/components/shortcut"
import { useControllableOpen } from "@/hooks/use-controllable-open"
import { cn } from "@/lib/utils"
import type { PermissionMode } from "@/types"

type ExecutionMode = Extract<
  PermissionMode,
  "plan" | "acceptEdits" | "bypassPermissions"
>

interface ModeMeta {
  trigger: string
  label: string
  description: string
  icon: typeof ClipboardList
  dot: string
}

const MODE_META: Record<ExecutionMode, ModeMeta> = {
  plan: {
    trigger: "Plan",
    label: "Plan mode",
    description: "Read-only",
    icon: ClipboardList,
    dot: "bg-amber-500",
  },
  acceptEdits: {
    trigger: "Accept edits",
    label: "Accept edits",
    description: "Auto-accept edits",
    icon: Pencil,
    dot: "bg-emerald-500",
  },
  bypassPermissions: {
    trigger: "Build",
    label: "Build Mode",
    description: "No prompts",
    icon: ShieldOff,
    dot: "bg-primary",
  },
}

const MODE_ORDER: ExecutionMode[] = ["plan", "acceptEdits", "bypassPermissions"]

interface ModeSelectorProps {
  value: PermissionMode
  onChange: (mode: PermissionMode) => void
  disabled?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** "toolbar" (default): compact ghost trigger with shortcut tooltip, for the
   *  composer. "form": full-width field-style trigger, for dialogs. */
  variant?: "toolbar" | "form"
}

/**
 * Permission-mode picker, rebuilt on @warden/ui to match the model selector. A
 * clean popover listing the execution modes (plan, accept edits, build). The
 * mode data + cycle order still live in controls/mode-menu during the
 * transition; this mirrors them.
 */
export function ModeSelector({
  value,
  onChange,
  disabled,
  open: controlledOpen,
  onOpenChange,
  variant = "toolbar",
}: ModeSelectorProps) {
  const [open, setOpen] = useControllableOpen(controlledOpen, onOpenChange)
  const active = MODE_META[value as ExecutionMode] ?? MODE_META.acceptEdits

  const triggerButton =
    variant === "form" ? (
      <Button
        variant="outline"
        disabled={disabled}
        className="h-9 w-full justify-between gap-2 px-3 font-normal"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("size-1.5 shrink-0 rounded-full", active.dot)} />
          <span className="truncate text-sm">{active.label}</span>
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
        <span className={cn("size-1.5 rounded-full", active.dot)} />
        {active.trigger}
        <ChevronDown className="size-3 opacity-50" />
      </Button>
    )

  return (
    <TooltipProvider>
      <Popover open={open} onOpenChange={setOpen}>
        {variant === "toolbar" ? (
          <Tooltip>
            <TooltipTrigger render={<PopoverTrigger render={triggerButton} />} />
            <TooltipPopup side="top" className="flex items-center gap-1.5">
              Mode
              <Shortcut combo={{ key: "Tab", shift: true }} />
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
                "w-64",
                variant === "form" && "min-w-[var(--anchor-width)]",
              )}
            >
              {MODE_ORDER.map((mode) => {
                const meta = MODE_META[mode]
                const Icon = meta.icon
                const selected = value === mode
                return (
                  <div
                    key={mode}
                    role="button"
                    tabIndex={0}
                    onClick={() => onChange(mode)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        onChange(mode)
                      }
                    }}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm outline-none transition-colors",
                      selected ? "bg-accent" : "hover:bg-accent/50",
                    )}
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="leading-tight">{meta.label}</span>
                      <span className="text-muted-foreground text-xs">
                        {meta.description}
                      </span>
                    </div>
                    {selected ? (
                      <Check className="size-4 shrink-0 text-primary" />
                    ) : null}
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
