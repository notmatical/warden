import { Check, ChevronsUpDown, Search } from "lucide-react"
import { useMemo, useState } from "react"

import { AnimatedZap } from "@/components/animated-zap"
import { Shortcut } from "@/components/shortcut"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
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

interface ModelMenuProps {
  value: string
  onChange: (model: string) => void
  /** Backend the session currently runs on; locks the provider once started. */
  backend: Backend
  /** Whether the session has taken a turn — after which the backend is fixed. */
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

export function ModelMenu({
  value,
  onChange,
  backend,
  started,
  disabled,
  open: controlledOpen,
  onOpenChange,
  variant = "toolbar",
}: ModelMenuProps) {
  const [open, setOpen] = useControllableOpen(controlledOpen, onOpenChange)
  const providers = useAppStore((s) => s.providers)
  const opencodeModels = useAppStore((s) => s.opencodeModels)
  const opencodeLoading = useAppStore((s) => s.opencodeModelsLoading)
  const base = baseModelId(value)
  const fast = isFastModel(value)
  const canFast = supportsFast(base)

  // Static models plus the account's live OpenCode catalog. The session's
  // current model always renders, even when no longer listed (a retired id,
  // or an OpenCode model the account lost access to).
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
  // While the OpenCode catalog is still loading there are no entries to
  // derive a rail item from — pin one so the pane exists and can skeleton.
  const allEntries = useMemo(() => {
    const entries = providerEntries(models)
    if (opencodeLoading && !entries.some((e) => e.backend === "opencode")) {
      entries.push({ name: "OpenCode", backend: "opencode" })
    }
    return entries
  }, [models, opencodeLoading])

  const activeProvider =
    models.find((m) => m.id === base)?.provider ?? allEntries[0].name

  // Every provider stays in the rail; the ones you can't pick right now are
  // shown disabled rather than hidden. After the first turn the backend is
  // fixed, so only the session's own provider stays live; unauthed providers
  // are disabled too. The session's own provider is always enabled (so the
  // menu is never empty).
  const authed = new Set(providers.filter((p) => p.authed).map((p) => p.id))
  const entries = allEntries.map((e) => {
    const isSessionProvider = e.backend === backend
    const enabled = isSessionProvider || (!started && authed.has(e.backend))
    const reason = enabled
      ? undefined
      : started && !isSessionProvider
        ? "Locked to this provider after the first turn"
        : "Sign in to this provider in Settings"
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
        m.id.toLowerCase().includes(q)
    )
  // The OpenCode pane fills from a CLI listing that takes a few seconds on
  // first load — skeleton it rather than claiming "no models".
  const paneLoading =
    opencodeLoading &&
    paneModels.length === 0 &&
    entries.find((e) => e.name === paneName)?.backend === "opencode"

  const ValueIcon = PRODUCT_ICON[backendForModel(value)]
  const trigger =
    variant === "form" ? (
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className="h-9 w-full justify-between gap-2 border-input bg-transparent px-3 font-normal hover:bg-input/30 dark:bg-input/30 dark:hover:bg-input/50"
        >
          <span className="flex min-w-0 items-center gap-2">
            <ValueIcon className="size-3.5 shrink-0" />
            <span className="truncate text-sm">{formatModelName(value)}</span>
            {fast && <AnimatedZap active className="size-3" />}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground/60" />
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
              className="h-7 gap-1.5 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ValueIcon className="size-3.5 shrink-0" />
              {formatModelName(value)}
              {fast && <AnimatedZap active className="size-3" />}
              <ChevronsUpDown className="size-3 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="flex items-center gap-1.5">
          Model
          <Shortcut combo={{ key: "e", mod: true }} />
        </TooltipContent>
      </Tooltip>
    )

  return (
    // Non-modal in the composer so typing stays live; modal in dialogs so the
    // menu (not the dialog's scroll lock) owns wheel events over its list.
    <DropdownMenu open={open} onOpenChange={setOpen} modal={variant === "form"}>
      {trigger}
      <DropdownMenuContent
        align="start"
        className={cn(
          "p-0",
          showRail ? "w-[22rem]" : "w-72",
          variant === "form" &&
            "min-w-[var(--radix-dropdown-menu-trigger-width)]"
        )}
      >
        <div className="flex items-center gap-2 border-b border-border/50 px-2.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          {/* Stop key events bubbling so the menu's typeahead doesn't steal them. */}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Search models"
            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="flex">
          {showRail ? (
            <div className="flex w-12 shrink-0 flex-col gap-1 border-r border-border/50 p-1.5">
              {entries.map((entry) => {
                const Icon = PRODUCT_ICON[entry.backend]
                const selected = entry.name === paneName
                return (
                  <button
                    key={entry.name}
                    type="button"
                    disabled={!entry.enabled}
                    aria-label={entry.name}
                    title={
                      entry.enabled
                        ? entry.name
                        : `${entry.name} — ${entry.reason}`
                    }
                    onClick={() => {
                      if (entry.enabled) selectPane(entry.name)
                    }}
                    // Product marks render in their brand colors, so state is
                    // carried by the backing and opacity, not icon tinting.
                    className={cn(
                      "flex aspect-square items-center justify-center rounded-md transition-colors",
                      !entry.enabled
                        ? "cursor-not-allowed opacity-30"
                        : selected
                          ? "bg-accent"
                          : "hover:bg-accent/50"
                    )}
                  >
                    <Icon className="size-4" />
                  </button>
                )
              })}
            </div>
          ) : null}

          {/* Fixed height (not max-height) so the popover doesn't resize when
					    switching providers or filtering. */}
          <div className="h-60 min-w-0 flex-1 overflow-y-auto p-1">
            {paneLoading ? (
              <div aria-busy="true" className="flex flex-col">
                {SKELETON_WIDTHS.map((width) => (
                  <div key={width} className="flex items-center px-2 py-2">
                    <Skeleton className="h-4 rounded" style={{ width }} />
                  </div>
                ))}
              </div>
            ) : paneModels.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                No models found
              </p>
            ) : (
              paneModels.map((model) => {
                const selected = model.id === base
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => onChange(withFast(model.id, fast))}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm outline-hidden transition-colors hover:bg-accent focus:bg-accent focus:text-accent-foreground"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {model.label}
                    </span>
                    <Check
                      className={cn(
                        "size-4 shrink-0",
                        selected ? "opacity-100" : "opacity-0"
                      )}
                    />
                  </button>
                )
              })
            )}
          </div>
        </div>

        <DropdownMenuSeparator className="mx-0 my-0" />
        <div className="p-1">
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
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
