import { Loader2 } from "lucide-react"
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

const PILL: Record<PillKind, string> = {
  ok: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/30 dark:text-emerald-500",
  warn: "bg-amber-500/10 text-amber-600 ring-amber-500/30 dark:text-amber-500",
  off: "bg-muted/60 text-muted-foreground ring-border",
}

/** Connection-state pill shared by every tool/integration card. */
export function StatePill({ kind, label }: { kind: PillKind; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-lg px-2 py-0.5 font-medium text-[11px] ring-1 ring-inset",
        PILL[kind]
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          kind === "ok"
            ? "bg-emerald-500"
            : kind === "warn"
              ? "bg-amber-500"
              : "bg-muted-foreground/40"
        )}
      />
      {label}
    </span>
  )
}

function statusPill(status: ProviderStatus): { kind: PillKind; label: string } {
  if (!status.installed) return { kind: "off", label: "Not installed" }
  if (!status.authed) return { kind: "warn", label: "Not signed in" }
  return { kind: "ok", label: "Connected" }
}

/** Card shell shared by every tool/integration tile: icon tile + name/version,
 *  state pill, description, and a footer row for controls. */
export function ToolCardShell({
  icon: Icon,
  name,
  version,
  pill,
  description,
  footer,
  children,
}: {
  icon: ComponentType<{ className?: string }>
  name: string
  version?: string | null
  pill: { kind: PillKind; label: string }
  description: string
  footer?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-xs ring-1 ring-foreground/10 transition-shadow hover:ring-foreground/20">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/60 ring-1 ring-border/50">
            <Icon className="size-[18px] text-foreground" />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-semibold text-foreground text-sm">
              {name}
            </span>
            {version ? (
              <span className="truncate font-mono text-[11px] text-muted-foreground tabular-nums">
                v{version.replace(/^v/, "")}
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
        <div className="mt-auto flex items-center justify-between gap-2">
          {footer}
        </div>
      ) : null}
      {children}
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

/** A managed-CLI tile (providers, GitHub CLI): source picker + Install /
 *  Sign in / Update action with live install progress, on the shared shell. */
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
  const { busy, progress, action } = useToolInstall({
    status,
    onInstall,
    onUpdate,
    onSignIn,
  })

  return (
    <ToolCardShell
      icon={icon}
      name={status.name}
      version={status.version}
      pill={statusPill(status)}
      description={description}
      footer={
        <>
          <SourcePicker status={status} onSetSource={onSetSource} />
          {action && !progress ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={action.onClick}
              disabled={busy}
              className={cn(
                "shrink-0",
                action.primary
                  ? "bg-foreground text-background hover:bg-foreground/90"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : action.label}
            </Button>
          ) : null}
        </>
      }
    >
      {progress ? (
        <div className="flex flex-col gap-1">
          <div className="h-0.5 overflow-hidden rounded-full bg-border">
            <div
              className="h-full bg-foreground/80 transition-[width] duration-300"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <span className="truncate font-mono text-[10px] text-muted-foreground">
            {progress.message}
          </span>
        </div>
      ) : null}
    </ToolCardShell>
  )
}
