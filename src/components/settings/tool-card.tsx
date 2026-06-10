import { ArrowUpCircle, Loader2 } from "lucide-react"
import type { ComponentType, ReactNode } from "react"

import { Button } from "@/components/ui/button"
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

type PillKind = "ok" | "warn" | "off"

const PILL: Record<PillKind, { surface: string; dot: string }> = {
  ok: {
    surface:
      "bg-emerald-500/10 text-emerald-600 ring-emerald-500/30 dark:text-emerald-500",
    dot: "bg-emerald-500",
  },
  warn: {
    surface:
      "bg-amber-500/10 text-amber-600 ring-amber-500/30 dark:text-amber-500",
    dot: "bg-amber-500",
  },
  off: {
    surface: "bg-muted/60 text-muted-foreground ring-border",
    dot: "bg-muted-foreground/40",
  },
}

/** Connection-state pill shared by every tool/integration card. */
export function StatePill({ kind, label }: { kind: PillKind; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-lg px-2 py-0.5 font-medium text-[11px] ring-1 ring-inset",
        PILL[kind].surface
      )}
    >
      <span className={cn("size-1.5 rounded-full", PILL[kind].dot)} />
      {label}
    </span>
  )
}

function statusPill(status: ProviderStatus): { kind: PillKind; label: string } {
  if (!status.installed) return { kind: "off", label: "Not installed" }
  if (!status.authed) return { kind: "warn", label: "Not signed in" }
  return { kind: "ok", label: "Connected" }
}

/** Card shell shared by every tool/integration tile: brand tile + identity,
 *  state pill, description, an optional full-bleed accent strip (updates,
 *  progress), and a footer row for controls. The tile goes ghost (dashed)
 *  when the tool isn't present, so install state reads at a glance. */
export function ToolCardShell({
  icon: Icon,
  name,
  meta,
  ghost = false,
  pill,
  description,
  strip,
  footer,
}: {
  icon: ComponentType<{ className?: string }>
  name: string
  /** Subdued identity line under the name (version, key type…). */
  meta?: ReactNode
  /** Dashed ghost treatment for the brand tile (tool not present). */
  ghost?: boolean
  pill: { kind: PillKind; label: string }
  description: string
  /** Full-bleed accent row between body and footer (update offer, progress). */
  strip?: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="group flex flex-col overflow-hidden rounded-xl bg-card shadow-xs ring-1 ring-foreground/10 transition-shadow hover:shadow-md hover:ring-foreground/15">
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors",
                ghost
                  ? "border border-border border-dashed text-muted-foreground/50"
                  : "bg-muted/60 text-foreground ring-1 ring-border/50"
              )}
            >
              <Icon className="size-5" />
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-semibold text-foreground text-sm leading-tight">
                {name}
              </span>
              {meta ? (
                <span className="truncate text-[11px] text-muted-foreground">
                  {meta}
                </span>
              ) : null}
            </div>
          </div>
          <StatePill kind={pill.kind} label={pill.label} />
        </div>

        <p className="text-muted-foreground text-xs leading-relaxed">
          {description}
        </p>

        {footer ? (
          <div className="mt-auto flex items-center justify-between gap-2 pt-1">
            {footer}
          </div>
        ) : null}
      </div>

      {strip}
    </div>
  )
}

/** Compact two-state source picker. Each option's hint shows up as a tooltip,
 *  so users see implications *before* picking — not as documentation after. */
function SourcePicker({
  status,
  onSetSource,
}: {
  status: ProviderStatus
  onSetSource: (source: ProviderSource) => void
}) {
  return (
    <div className="flex w-fit shrink-0 rounded-md border border-border/60 bg-muted/30 p-0.5">
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
              "rounded-[5px] px-2 py-0.5 font-medium text-[11px] transition-colors",
              unavailable
                ? "cursor-not-allowed text-muted-foreground/40"
                : active
                  ? "bg-background text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06)]"
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

function cleanVersion(version: string): string {
  return version.replace(/^v/, "")
}

/** A managed-CLI tile (providers, GitHub CLI) on the shared shell. Pending
 *  updates surface as a tinted full-bleed strip with the version delta and a
 *  real button — not a label you have to squint for. */
export function ToolCard({
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

  // Update gets the strip; Install / Sign in stay footer actions (they are the
  // card's only possible action in those states, so the footer is enough).
  const updatePending = status.installed && status.updateAvailable
  const footerAction =
    action && action.label !== "Update" && !progress ? action : null

  const strip = progress ? (
    <div className="flex flex-col gap-1.5 border-border/60 border-t bg-muted/30 px-4 py-2.5">
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
          className="h-full rounded-full bg-foreground/80 transition-[width] duration-300"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
    </div>
  ) : updatePending ? (
    <div className="flex items-center gap-2.5 border-sky-500/20 border-t bg-sky-500/10 px-4 py-2">
      <ArrowUpCircle className="size-4 shrink-0 text-sky-500" />
      <span className="min-w-0 flex-1 truncate text-sky-600 text-xs dark:text-sky-400">
        Update available
        {status.version && status.latestVersion ? (
          <span className="ml-1.5 font-mono text-[11px] tabular-nums opacity-80">
            v{cleanVersion(status.version)} → v
            {cleanVersion(status.latestVersion)}
          </span>
        ) : null}
      </span>
      <Button
        size="xs"
        onClick={runUpdate}
        disabled={busy}
        className="shrink-0 bg-sky-500 text-white hover:bg-sky-600 dark:bg-sky-500 dark:hover:bg-sky-400"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : "Update"}
      </Button>
    </div>
  ) : null

  return (
    <ToolCardShell
      icon={icon}
      name={status.name}
      meta={
        status.version ? (
          <span className="font-mono tabular-nums">
            v{cleanVersion(status.version)}
          </span>
        ) : undefined
      }
      ghost={!status.installed}
      pill={statusPill(status)}
      description={description}
      strip={strip}
      footer={
        <>
          <SourcePicker status={status} onSetSource={onSetSource} />
          {footerAction ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={footerAction.onClick}
              disabled={busy}
              className={cn(
                "shrink-0",
                footerAction.primary
                  ? "bg-foreground text-background hover:bg-foreground/90"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {busy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                footerAction.label
              )}
            </Button>
          ) : null}
        </>
      }
    />
  )
}
