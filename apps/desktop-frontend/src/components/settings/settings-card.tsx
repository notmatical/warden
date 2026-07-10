import type { ComponentType, ReactNode } from "react"

import { cn } from "@/lib/utils"

export type CardStateKind = "ok" | "warn" | "off"

const DOT: Record<CardStateKind, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  off: "bg-muted-foreground/40",
}

/** A colored state dot + label, anchored in a card header. */
export function StatusDot({
  kind,
  label,
}: {
  kind: CardStateKind
  label: string
}) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
      <span className={cn("size-1.5 rounded-full", DOT[kind])} />
      {label}
    </span>
  )
}

/** The shared card shell for a settings surface (providers, integrations): a
 *  brand tile with a status dot anchored top-right, a two-line identity
 *  (name + version, then description), and a footer (`children`) pinned to the
 *  card bottom for the one control that matters. The card is a `group` so
 *  secondary controls can reveal on hover. */
export function SettingsCard({
  icon: Icon,
  present = true,
  name,
  version,
  description,
  statusKind,
  statusLabel,
  headerAction,
  children,
}: {
  icon: ComponentType<{ className?: string }>
  /** When false, the tile gets the softer "not present" treatment. */
  present?: boolean
  name: string
  version?: string | null
  description: string
  statusKind: CardStateKind
  statusLabel: string
  /** Secondary control shown left of the status (e.g. a hover Disconnect). */
  headerAction?: ReactNode
  /** Footer content, pinned to the card bottom. */
  children?: ReactNode
}) {
  return (
    <div className="group relative flex flex-col rounded-xl border border-border/60 bg-card p-4 shadow-xs transition-colors hover:border-border">
      <div className="flex items-center justify-between gap-2">
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-lg ring-1 ring-inset transition-colors",
            present
              ? "bg-muted/50 text-foreground ring-border/60"
              : "bg-muted/30 text-muted-foreground/60 ring-border/50"
          )}
        >
          <Icon className="size-5" />
        </div>
        <div className="flex items-center gap-2">
          {headerAction}
          <StatusDot kind={statusKind} label={statusLabel} />
        </div>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="truncate font-medium text-foreground text-sm">
          {name}
        </span>
        {version ? (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70 tabular-nums">
            v{version.replace(/^v/, "")}
          </span>
        ) : null}
      </div>
      <p className="mt-1 line-clamp-2 text-muted-foreground text-xs leading-4">
        {description}
      </p>

      {children ? <div className="mt-auto pt-4">{children}</div> : null}
    </div>
  )
}
