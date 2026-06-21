import { Button } from "@warden/ui/components/button"
import {
  Popover,
  PopoverPrimitive,
  PopoverTrigger,
} from "@warden/ui/components/popover"
import { ScrollArea } from "@warden/ui/components/scroll-area"
import { Skeleton } from "@warden/ui/components/skeleton"
import {
  Tooltip,
  TooltipPopup,
  TooltipProvider,
  TooltipTrigger,
} from "@warden/ui/components/tooltip"
import { Check, ChevronsUpDown, Search } from "lucide-react"
import { useMemo, useState } from "react"

import { AnimatedZap } from "@/components/animated-zap"
import { Shortcut } from "@/components/shortcut"
import { useControllableOpen } from "@/hooks/use-controllable-open"
import {
  BACKEND_PROVIDER_NAME,
  backendForModel,
  baseModelId,
  formatModelName,
  isFastModel,
  MODELS,
  providerEntries,
  supportsFast,
  withFast,
} from "@/lib/models"
import { PRODUCT_ICON } from "@/lib/provider-icons"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"
import type { Backend } from "@/types"

interface ModelSelectorProps {
  value: string
  onChange: (model: string) => void
  /** Backend the session currently runs on; locks the provider once started. */
  backend: Backend
  /** Whether the session has taken a turn, after which the backend is fixed. */
  started: boolean
  disabled?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** "toolbar" (default): compact ghost trigger with shortcut tooltip, for the
   *  composer. "form": full-width field-style trigger, for dialogs. */
  variant?: "toolbar" | "form"
}

/** Varied row widths so the loading pane reads as a list, not a block. */
const SKELETON_WIDTHS = ["72%", "58%", "80%", "64%", "70%", "52%"]

/**
 * Model picker, rebuilt on @warden/ui (coss/Base-UI). A popover with a compact
 * provider rail and a model list. The fast service tier is collapsed into the
 * models that support it: each fast-capable row carries an inline zap toggle
 * (row click selects the standard tier, the zap selects the priority tier), so
 * there is no separate global fast switch.
 */
export function ModelSelector({
  value,
  onChange,
  backend,
  started,
  disabled,
  open: controlledOpen,
  onOpenChange,
  variant = "toolbar",
}: ModelSelectorProps) {
  const [open, setOpen] = useControllableOpen(controlledOpen, onOpenChange)
  const providers = useAppStore((s) => s.providers)
  const opencodeModels = useAppStore((s) => s.opencodeModels)
  const opencodeLoading = useAppStore((s) => s.opencodeModelsLoading)
  const base = baseModelId(value)
  const fast = isFastModel(value)

  // Static models plus the account's live OpenCode catalog. The session's
  // current model always renders, even when no longer listed.
  const models = useMemo(() => {
    const all = [...MODELS, ...opencodeModels]
    if (!all.some((m) => m.id === base)) {
      all.push({
        id: base,
        label: formatModelName(base),
        provider: BACKEND_PROVIDER_NAME[backendForModel(base)],
      })
    }
    return all
  }, [opencodeModels, base])

  const allEntries = useMemo(() => {
    const entries = providerEntries(models)
    if (opencodeLoading && !entries.some((e) => e.backend === "opencode")) {
      entries.push({ name: "OpenCode", backend: "opencode" })
    }
    return entries
  }, [models, opencodeLoading])

  const activeProvider =
    models.find((m) => m.id === base)?.provider ?? allEntries[0].name

  // Every provider stays in the rail; ones you can't pick now show disabled.
  // After the first turn the backend is fixed to the session's own provider.
  const authed = new Set(providers.filter((p) => p.authed).map((p) => p.id))
  const entries = allEntries.map((e) => {
    const isSessionProvider = e.backend === backend
    const enabled = isSessionProvider || (!started && authed.has(e.backend))
    // Only the actionable "sign in" reason shows in the tooltip; a provider
    // locked after the first turn just shows its name.
    const locked = started && !isSessionProvider
    const reason =
      enabled || locked ? undefined : "Sign in to this provider in Settings"
    return { ...e, enabled, reason }
  })
  const showRail = entries.length > 1

  const [pane, setPane] = useState(activeProvider)
  const [query, setQuery] = useState("")
  const [seenOpen, setSeenOpen] = useState(open)
  if (open !== seenOpen) {
    setSeenOpen(open)
    if (open) {
      setPane(activeProvider)
      setQuery("")
    }
  }
  const paneName = entries.some((e) => e.name === pane)
    ? pane
    : entries.some((e) => e.name === activeProvider)
      ? activeProvider
      : entries[0].name

  const selectPane = (name: string) => {
    setPane(name)
    setQuery("")
  }

  const q = query.trim().toLowerCase()
  const paneModels = models
    .filter((m) => m.provider === paneName)
    .filter(
      (m) =>
        !q ||
        m.label.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q),
    )
  const paneLoading =
    opencodeLoading &&
    paneModels.length === 0 &&
    entries.find((e) => e.name === paneName)?.backend === "opencode"

  const ValueIcon = PRODUCT_ICON[backendForModel(value)]
  const triggerButton =
    variant === "form" ? (
      <Button
        variant="outline"
        disabled={disabled}
        className="h-9 w-full justify-between gap-2 px-3 font-normal"
      >
        <span className="flex min-w-0 items-center gap-2">
          <ValueIcon className="size-3.5 shrink-0" />
          <span className="truncate text-sm">{formatModelName(value)}</span>
          {fast && <AnimatedZap active className="size-3" />}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground/60" />
      </Button>
    ) : (
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        className="h-7 gap-1.5 px-2 font-medium text-muted-foreground text-xs hover:text-foreground"
      >
        <ValueIcon className="size-3.5 shrink-0" />
        {formatModelName(value)}
        {fast && <AnimatedZap active className="size-3" />}
        <ChevronsUpDown className="size-3 opacity-50" />
      </Button>
    )

  return (
    <TooltipProvider>
      <Popover open={open} onOpenChange={setOpen}>
        {variant === "toolbar" ? (
          <Tooltip>
            <TooltipTrigger render={<PopoverTrigger render={triggerButton} />} />
            <TooltipPopup side="top" className="flex items-center gap-1.5">
              Model
              <Shortcut combo={{ key: "e", mod: true }} />
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
                "relative flex origin-(--transform-origin) flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg/8 outline-none transition-[transform,opacity] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
                showRail ? "w-[22rem]" : "w-72",
                variant === "form" && "min-w-[var(--anchor-width)]",
              )}
            >
              {/* Search */}
              <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
                <Search className="size-3.5 shrink-0 text-muted-foreground" />
                {/* Stop keys bubbling so typeahead doesn't steal them. */}
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder="Search models"
                  className="h-7 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>

              <div className="flex min-h-0">
                {showRail ? (
                  <div className="flex w-11 shrink-0 flex-col gap-1 p-1.5">
                    {entries.map((entry) => {
                      const Icon = PRODUCT_ICON[entry.backend]
                      const selected = entry.name === paneName
                      return (
                        <Tooltip key={entry.name}>
                          <TooltipTrigger
                            render={
                              <button
                                type="button"
                                aria-disabled={!entry.enabled}
                                aria-label={entry.name}
                                tabIndex={entry.enabled ? 0 : -1}
                                onClick={() => {
                                  if (entry.enabled) selectPane(entry.name)
                                }}
                                className={cn(
                                  "flex aspect-square items-center justify-center rounded-lg transition-colors",
                                  !entry.enabled
                                    ? "cursor-not-allowed opacity-30"
                                    : selected
                                      ? "bg-accent"
                                      : "hover:bg-accent/50",
                                )}
                              />
                            }
                          >
                            <Icon className="size-4" />
                          </TooltipTrigger>
                          <TooltipPopup
                            side="left"
                            className="w-fit whitespace-nowrap"
                          >
                            {entry.reason
                              ? `${entry.name}: ${entry.reason}`
                              : entry.name}
                          </TooltipPopup>
                        </Tooltip>
                      )
                    })}
                  </div>
                ) : null}

                {/* Fixed height so the popover doesn't resize on switch/filter. */}
                <ScrollArea className="h-60 min-w-0 flex-1" scrollFade>
                  <div className="pr-1.5">
                    {paneLoading ? (
                      <div aria-busy="true" className="flex flex-col">
                        {SKELETON_WIDTHS.map((width) => (
                          <div
                            key={width}
                            className="flex items-center px-2 py-2"
                          >
                            <Skeleton className="h-4 rounded" style={{ width }} />
                          </div>
                        ))}
                      </div>
                    ) : paneModels.length === 0 ? (
                      <p className="px-2 py-6 text-center text-muted-foreground text-sm">
                        No models found
                      </p>
                    ) : (
                      paneModels.map((model) => {
                        const selected = model.id === base
                        const canFast = supportsFast(model.id)
                        const rowFast = selected && fast
                        return (
                          <div
                            key={model.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => onChange(model.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault()
                                onChange(model.id)
                              }
                            }}
                            className={cn(
                              "flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm outline-none transition-colors",
                              selected ? "bg-accent" : "hover:bg-accent/50",
                            )}
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {model.label}
                            </span>
                            {canFast ? (
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        onChange(withFast(model.id, !rowFast))
                                      }}
                                      aria-label={`Fast tier for ${model.label}`}
                                      aria-pressed={rowFast}
                                      className={cn(
                                        "flex size-5 shrink-0 items-center justify-center rounded-md outline-none transition-colors",
                                        rowFast
                                          ? "text-primary"
                                          : "text-muted-foreground/40 hover:bg-foreground/10 hover:text-foreground",
                                      )}
                                    >
                                      <AnimatedZap
                                        active={rowFast}
                                        className="size-3.5"
                                      />
                                    </button>
                                  }
                                />
                                <TooltipPopup
                                  side="top"
                                  className="w-fit whitespace-nowrap"
                                >
                                  Faster responses, same model
                                </TooltipPopup>
                              </Tooltip>
                            ) : null}
                            {selected ? (
                              <Check className="size-4 shrink-0 text-primary" />
                            ) : null}
                          </div>
                        )
                      })
                    )}
                  </div>
                </ScrollArea>
              </div>
            </PopoverPrimitive.Popup>
          </PopoverPrimitive.Positioner>
        </PopoverPrimitive.Portal>
      </Popover>
    </TooltipProvider>
  )
}
