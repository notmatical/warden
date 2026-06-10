import {
  Check,
  ChevronDown,
  ClipboardList,
  Pencil,
  ShieldOff,
} from "lucide-react"

import { Shortcut } from "@/components/shortcut"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
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
  danger?: boolean
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
    trigger: "Bypass",
    label: "Bypass permissions",
    description: "No prompts",
    icon: ShieldOff,
    dot: "bg-red-500",
    danger: true,
  },
}

/** Cycle order for the Shift+Tab shortcut. */
export const MODE_ORDER: ExecutionMode[] = [
  "plan",
  "acceptEdits",
  "bypassPermissions",
]

/** The next mode in the cycle, wrapping around. Unknown modes start at the top. */
export function cycleMode(current: PermissionMode): PermissionMode {
  const index = MODE_ORDER.indexOf(current as ExecutionMode)
  return MODE_ORDER[(index + 1) % MODE_ORDER.length]
}

interface ModeMenuProps {
  value: PermissionMode
  onChange: (mode: PermissionMode) => void
  disabled?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** "toolbar" (default): compact ghost trigger with shortcut tooltip, for the
   *  composer. "form": full-width field-style trigger, for dialogs. */
  variant?: "toolbar" | "form"
}

export function ModeMenu({
  value,
  onChange,
  disabled,
  open: controlledOpen,
  onOpenChange,
  variant = "toolbar",
}: ModeMenuProps) {
  const [open, setOpen] = useControllableOpen(controlledOpen, onOpenChange)
  const active = MODE_META[value as ExecutionMode] ?? MODE_META.acceptEdits

  const trigger =
    variant === "form" ? (
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className="h-9 w-full justify-between gap-2 border-input bg-transparent px-3 font-normal hover:bg-input/30 dark:bg-input/30 dark:hover:bg-input/50"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn("size-1.5 shrink-0 rounded-full", active.dot)} />
            <span className="truncate text-sm">{active.label}</span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/60" />
        </Button>
      </DropdownMenuTrigger>
    ) : (
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              className="h-7 gap-1.5 px-2.5 text-xs font-medium text-foreground/80 hover:text-foreground"
            >
              <span className={cn("size-1.5 rounded-full", active.dot)} />
              {active.trigger}
              <ChevronDown className="size-3 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="flex items-center gap-1.5">
          Mode
          <Shortcut combo={{ key: "Tab", shift: true }} />
        </TooltipContent>
      </Tooltip>
    )

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      {trigger}
      <DropdownMenuContent align="start" className="w-64">
        {MODE_ORDER.map((mode) => {
          const meta = MODE_META[mode]
          const Icon = meta.icon
          const selected = value === mode
          return (
            <DropdownMenuItem
              key={mode}
              variant={meta.danger ? "destructive" : "default"}
              onSelect={() => onChange(mode)}
              className="gap-2.5 py-2"
            >
              <Check
                className={cn(
                  "size-4 shrink-0",
                  selected ? "opacity-100" : "opacity-0"
                )}
              />
              <Icon
                className={cn(
                  "size-4",
                  !meta.danger && "text-muted-foreground"
                )}
              />
              <div className="flex min-w-0 flex-col">
                <span className="text-sm leading-tight">{meta.label}</span>
                <span className="text-xs text-muted-foreground">
                  {meta.description}
                </span>
              </div>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
