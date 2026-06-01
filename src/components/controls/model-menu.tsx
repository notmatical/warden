import { Fragment } from "react"
import { ChevronsUpDown } from "lucide-react"

import { AnimatedZap } from "@/components/animated-zap"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import { useControllableOpen } from "@/hooks/use-controllable-open"
import { cn } from "@/lib/utils"
import {
  MODEL_PROVIDERS,
  MODELS,
  baseModelId,
  formatModelName,
  isFastModel,
  supportsFast,
  withFast,
} from "@/lib/models"

interface ModelMenuProps {
  value: string
  onChange: (model: string) => void
  disabled?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function ModelMenu({
  value,
  onChange,
  disabled,
  open: controlledOpen,
  onOpenChange,
}: ModelMenuProps) {
  const [open, setOpen] = useControllableOpen(controlledOpen, onOpenChange)
  const base = baseModelId(value)
  const fast = isFastModel(value)
  const canFast = supportsFast(base)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="h-7 gap-1.5 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {formatModelName(value)}
          {fast && <AnimatedZap active className="size-3" />}
          <ChevronsUpDown className="size-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuRadioGroup
          value={base}
          onValueChange={(next) => onChange(withFast(next, fast))}
        >
          {MODEL_PROVIDERS.map((provider, i) => (
            <Fragment key={provider}>
              {i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {provider}
              </DropdownMenuLabel>
              {MODELS.filter((m) => m.provider === provider).map((model) => (
                <DropdownMenuRadioItem key={model.id} value={model.id}>
                  {model.label}
                </DropdownMenuRadioItem>
              ))}
            </Fragment>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Fast mode
        </DropdownMenuLabel>
        <div className="flex items-center justify-between gap-3 px-2 pt-0.5 pb-1.5">
          <span
            className={cn(
              "flex items-center gap-2 text-sm",
              !canFast && "text-muted-foreground"
            )}
          >
            <AnimatedZap active={fast && canFast} className="size-4" />
            Enable fast mode
          </span>
          <Switch
            checked={fast}
            disabled={!canFast}
            onCheckedChange={(checked) => onChange(withFast(base, checked))}
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
