import { Button } from "@warden/ui/components/button"
import { ArrowUpCircle } from "lucide-react"
import type { ComponentType, ReactNode } from "react"

import { cn } from "@/lib/utils"
import type { ProviderSource, ProviderStatus } from "@/types"

import { useToolInstall } from "./use-tool-install"

const SOURCES: { value: ProviderSource; label: string; hint: string }[] = [
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

export type ToolStateKind = "ok" | "warn" | "off"

const PILL: Record<ToolStateKind, string> = {
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warn: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  off: "bg-muted text-muted-foreground",
}

const DOT: Record<ToolStateKind, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  off: "bg-muted-foreground/40",
}

/** A small status badge — dot + label in a tinted pill. Callers place it in a
 *  row's action slot so status sits with the controls, not buried in the copy. */
export function StatusPill({
  kind,
  label,
}: {
  kind: ToolStateKind
  label: string
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 font-medium text-[11px]",
        PILL[kind]
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOT[kind])} />
      {label}
    </span>
  )
}

/** One bordered container for a section's tool rows — the settings-list
 *  pattern (one surface, hairline-divided rows) instead of floating cards. */
export function ToolList({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border/50 overflow-hidden rounded-xl bg-card shadow-xs ring-1 ring-foreground/10">
      {children}
    </div>
  )
}

/** A tool row: brand tile, a clean two-line identity (name + version, then
 *  description), a right-aligned action cluster, and an optional attached band
 *  underneath (update offer, install progress, a detail toggle). The row is a
 *  `group` so secondary controls can reveal on hover. */
export function ToolListRow({
  icon: Icon,
  name,
  version,
  ghost = false,
  description,
  actions,
  band,
}: {
  icon: ComponentType<{ className?: string }>
  name: string
  /** Mono version tag after the name. */
  version?: string | null
  /** Softer tile treatment when the tool isn't present. */
  ghost?: boolean
  description: string
  /** Right-aligned controls (status pill, source picker, action buttons). */
  actions?: ReactNode
  /** Full-width attached band under the row (update offer, progress, toggle). */
  band?: ReactNode
}) {
  return (
    <div>
      <div className="group flex items-center gap-3.5 px-4 py-3 transition-colors hover:bg-muted/25">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset transition-colors",
            ghost
              ? "bg-muted/30 text-muted-foreground/50 ring-border/50"
              : "bg-gradient-to-b from-muted/50 to-muted text-foreground ring-border/60"
          )}
        >
          <Icon className="size-[18px]" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-medium text-foreground text-sm">
              {name}
            </span>
            {version ? (
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70 tabular-nums">
                v{version.replace(/^v/, "")}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-muted-foreground text-xs">
            {description}
          </p>
        </div>

        {actions ? (
          <div className="flex shrink-0 items-center gap-2.5">{actions}</div>
        ) : null}
      </div>
      {band}
    </div>
  )
}

/** Compact two-state source picker: a segmented control. Reveals on row hover so
 *  rows stay calm at rest; each option's hint is a tooltip. */
function SourcePicker({
  status,
  onSetSource,
}: {
  status: ProviderStatus
  onSetSource: (source: ProviderSource) => void
}) {
  return (
    <div className="flex w-fit shrink-0 rounded-lg bg-muted/70 p-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 has-[:focus-visible]:opacity-100">
      {SOURCES.map((opt) => {
        const active = status.source === opt.value
        // Managed is always selectable (selecting it offers Install);
        // System needs an actual PATH binary.
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

function toolState(status: ProviderStatus): {
  kind: ToolStateKind
  label: string
} {
  if (!status.installed) return { kind: "off", label: "Not installed" }
  if (!status.authed) return { kind: "warn", label: "Not signed in" }
  return { kind: "ok", label: "Connected" }
}

/** A managed-CLI row (providers, GitHub CLI). At rest it shows a status pill or
 *  the one action that matters (Install / Sign in); the source picker reveals on
 *  hover. Pending updates and install progress attach as a band underneath. */
export function ToolRow({
  status,
  icon,
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

  // Update gets the band; Install / Sign in stay row actions (they are the
  // row's only possible action in those states).
  const state = toolState(status)
  const updatePending = status.installed && status.updateAvailable
  const rowAction =
    action && action.label !== "Update" && !progress ? action : null

  const band = progress ? (
    <div className="flex flex-col gap-1.5 border-border/50 border-t bg-muted/30 px-4 py-2.5">
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
  ) : updatePending ? (
    <div className="flex items-center gap-2.5 border-primary/15 border-t bg-primary/6 px-4 py-2">
      <ArrowUpCircle className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate text-primary text-xs">
        Update available
        {status.version && status.latestVersion ? (
          <span className="ml-1.5 font-mono text-[11px] tabular-nums opacity-70">
            v{status.version.replace(/^v/, "")} → v
            {status.latestVersion.replace(/^v/, "")}
          </span>
        ) : null}
      </span>
      <Button size="xs" onClick={runUpdate} loading={busy} className="shrink-0">
        Update
      </Button>
    </div>
  ) : null

  return (
    <ToolListRow
      icon={icon}
      name={status.name}
      version={status.version}
      ghost={!status.installed}
      description={description}
      band={band}
      actions={
        <>
          <SourcePicker status={status} onSetSource={onSetSource} />
          {rowAction ? (
            <Button
              variant={rowAction.primary ? "default" : "outline"}
              size="xs"
              onClick={rowAction.onClick}
              loading={busy}
              className="shrink-0"
            >
              {rowAction.label}
            </Button>
          ) : (
            <StatusPill kind={state.kind} label={state.label} />
          )}
        </>
      }
    />
  )
}
