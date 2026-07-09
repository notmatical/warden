import { Button } from "@warden/ui/components/button"
import { ArrowRight } from "lucide-react"
import type { ComponentType } from "react"

import { cn } from "@/lib/utils"
import type { ProviderSource, ProviderStatus } from "@/types"

import { useToolInstall } from "./use-tool-install"

type StateKind = "ok" | "warn" | "off"

const DOT: Record<StateKind, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  off: "bg-muted-foreground/40",
}

function providerState(status: ProviderStatus): {
  kind: StateKind
  label: string
} {
  if (!status.installed) return { kind: "off", label: "Not installed" }
  if (!status.authed) return { kind: "warn", label: "Not signed in" }
  return { kind: "ok", label: "Connected" }
}

/** A two-state source picker, revealed on card hover so cards stay calm at rest. */
function SourcePicker({
  status,
  onSetSource,
}: {
  status: ProviderStatus
  onSetSource: (source: ProviderSource) => void
}) {
  const options: { value: ProviderSource; label: string; hint: string }[] = [
    {
      value: "managed",
      label: "Managed",
      hint: "warden installs this and keeps it updated.",
    },
    {
      value: "system",
      label: "System",
      hint: "Use your PATH install — you manage updates.",
    },
  ]
  return (
    <div className="flex w-fit rounded-lg bg-muted/70 p-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 has-[:focus-visible]:opacity-100">
      {options.map((opt) => {
        const active = status.source === opt.value
        const unavailable = opt.value === "system" && !status.systemDetected
        return (
          <button
            key={opt.value}
            type="button"
            disabled={unavailable}
            onClick={() => onSetSource(opt.value)}
            title={unavailable ? "Not found on PATH" : opt.hint}
            className={cn(
              "rounded-[7px] px-2 py-0.5 font-medium text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              unavailable
                ? "cursor-not-allowed text-muted-foreground/40"
                : active
                  ? "bg-background text-foreground shadow-xs ring-1 ring-border/50"
                  : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/** A single provider as a card in the Providers grid. Brand mark, name +
 *  version, one line of description, and a footer that carries either the
 *  connected status (with a hover-revealed source picker) or the single action
 *  that matters — Install, Sign in, or Update. */
export function ProviderCard({
  status,
  icon: Icon,
  description,
  onInstall,
  onUpdate,
  onSetSource,
  onSignIn,
}: {
  status: ProviderStatus
  icon: ComponentType<{ className?: string }>
  description: string
  onInstall: () => Promise<void>
  onUpdate: () => Promise<void>
  onSetSource: (source: ProviderSource) => void
  onSignIn?: () => void
}) {
  const { busy, progress, action, runUpdate } = useToolInstall({
    status,
    onInstall,
    onUpdate,
    onSignIn,
  })
  const state = providerState(status)
  const installed = status.installed
  const updatePending = installed && status.updateAvailable
  // Install / Sign in are the card's headline action; Update lives in the
  // connected footer so a working provider still reads as connected.
  const primary = action && action.label !== "Update" ? action : null

  return (
    <div className="group relative flex flex-col rounded-xl border border-border/60 bg-card p-4 shadow-xs transition-colors hover:border-border">
      <div
        className={cn(
          "flex size-10 items-center justify-center rounded-lg ring-1 ring-inset transition-colors",
          installed
            ? "bg-muted/50 text-foreground ring-border/60"
            : "bg-muted/30 text-muted-foreground/60 ring-border/50"
        )}
      >
        <Icon className="size-5" />
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="truncate font-medium text-foreground text-sm">
          {status.name}
        </span>
        {status.version ? (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70 tabular-nums">
            v{status.version.replace(/^v/, "")}
          </span>
        ) : null}
      </div>
      <p className="mt-1 line-clamp-2 text-muted-foreground text-xs leading-4">
        {description}
      </p>

      <div className="mt-auto pt-4">
        {progress ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-[10px] text-muted-foreground">
                {progress.message}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                {Math.round(progress.percent)}%
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        ) : primary ? (
          <Button
            variant={primary.primary ? "default" : "outline"}
            size="sm"
            onClick={primary.onClick}
            loading={busy}
            className="w-full"
          >
            {primary.label}
            <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
          </Button>
        ) : (
          <div className="flex min-h-7 items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
              <span className={cn("size-1.5 rounded-full", DOT[state.kind])} />
              {state.label}
            </span>
            {updatePending ? (
              <Button size="xs" onClick={runUpdate} loading={busy}>
                Update
              </Button>
            ) : (
              <SourcePicker status={status} onSetSource={onSetSource} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
