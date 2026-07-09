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

export type ToolStateKind = "ok" | "warn" | "off"

const STATE: Record<ToolStateKind, { dot: string; text: string }> = {
  ok: { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-500" },
  warn: { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-500" },
  off: { dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
}

/** One bordered container for a section's tool rows — the settings-list
 *  pattern (one surface, hairline-divided rows) instead of floating cards. */
export function ToolList({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card shadow-xs ring-1 ring-foreground/10">
      {children}
    </div>
  )
}

/** A tool row: brand tile, identity + live status line, right-aligned
 *  controls, and an optional attached band underneath (update offer, install
 *  progress). The tile goes ghost (dashed) when the tool isn't present. */
export function ToolListRow({
  icon: Icon,
  name,
  version,
  ghost = false,
  state,
  description,
  actions,
  band,
}: {
  icon: ComponentType<{ className?: string }>
  name: string
  /** Mono version tag after the name. */
  version?: string | null
  /** Dashed ghost treatment for the brand tile (tool not present). */
  ghost?: boolean
  state: { kind: ToolStateKind; label: string }
  description: string
  /** Right-aligned controls (source picker, action buttons, forms). */
  actions?: ReactNode
  /** Full-width attached band under the row (update offer, progress). */
  band?: ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-3.5 px-4 py-3.5">
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

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-medium text-foreground text-sm">
              {name}
            </span>
            {version ? (
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                v{version.replace(/^v/, "")}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                STATE[state.kind].dot
              )}
            />
            <span className={cn("shrink-0", STATE[state.kind].text)}>
              {state.label}
            </span>
            <span className="shrink-0 text-muted-foreground/40">·</span>
            <span className="truncate text-muted-foreground">
              {description}
            </span>
          </div>
        </div>

        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {band}
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

function toolState(status: ProviderStatus): {
  kind: ToolStateKind
  label: string
} {
  if (!status.installed) return { kind: "off", label: "Not installed" }
  if (!status.authed) return { kind: "warn", label: "Not signed in" }
  return { kind: "ok", label: "Connected" }
}

/** A managed-CLI row (providers, GitHub CLI). Pending updates surface as a
 *  tinted attached band with the version delta and a real button — not a
 *  label you have to squint for. */
export function ToolRow({
  status,
  icon,
  description,
  onInstall,
  onUpdate,
  onSetSource,
  onSignIn,
  installable = true,
  installHint,
}: {
  status: ProviderStatus
  icon: ComponentType<{ className?: string }>
  description: string
  onInstall: () => Promise<void>
  onUpdate: () => Promise<void>
  onSetSource: (source: ProviderSource) => void
  onSignIn?: () => void
  /** Whether warden can install this tool here (false ⇒ no Install button). */
  installable?: boolean
  /** Shown in place of the Install button when uninstalled and not installable
   *  (e.g. Cursor on Windows). */
  installHint?: string
}) {
  const { busy, progress, action, runUpdate } = useToolInstall({
    status,
    onInstall,
    onUpdate,
    onSignIn,
    installable,
  })

  // Update gets the band; Install / Sign in stay row actions (they are the
  // row's only possible action in those states).
  const updatePending = status.installed && status.updateAvailable
  const rowAction =
    action && action.label !== "Update" && !progress ? action : null
  // When we can't install here, a muted hint stands in for the Install button.
  const hint =
    !status.installed && !installable && installHint && !progress
      ? installHint
      : null

  const band = progress ? (
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
            v{status.version.replace(/^v/, "")} → v
            {status.latestVersion.replace(/^v/, "")}
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
    <ToolListRow
      icon={icon}
      name={status.name}
      version={status.version}
      ghost={!status.installed}
      state={toolState(status)}
      description={description}
      band={band}
      actions={
        <>
          <SourcePicker status={status} onSetSource={onSetSource} />
          {hint ? (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {hint}
            </span>
          ) : rowAction ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={rowAction.onClick}
              disabled={busy}
              className={cn(
                "shrink-0",
                rowAction.primary
                  ? "bg-foreground text-background hover:bg-foreground/90"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {busy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                rowAction.label
              )}
            </Button>
          ) : null}
        </>
      }
    />
  )
}
