import { Loader2 } from "lucide-react"
import type { ComponentType } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ProviderSource, ProviderStatus } from "@/types"

import { connectionState, useToolInstall } from "./use-tool-install"

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

interface ToolRowProps {
  status: ProviderStatus
  icon: ComponentType<{ className?: string }>
  onInstall: () => Promise<void>
  onUpdate: () => Promise<void>
  onSetSource: (source: ProviderSource) => void
  onSignIn?: () => void
}

/** Compact two-state source picker. Each option's hint shows up as a tooltip,
 *  so users see implications *before* picking — not as documentation after. */
function SourcePicker({
  status,
  onSetSource,
}: Pick<ToolRowProps, "status" | "onSetSource">) {
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
              "rounded-[5px] px-2 py-0.5 text-[11px] font-medium transition-colors",
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

/** One managed CLI: brand mark + one-line metadata + compact source picker +
 *  an Install / Sign in / Update action with live install progress. */
export function ToolRow({
  status,
  icon: Icon,
  onInstall,
  onUpdate,
  onSetSource,
  onSignIn,
}: ToolRowProps) {
  const { busy, progress, action } = useToolInstall({
    status,
    onInstall,
    onUpdate,
    onSignIn,
  })
  const state = connectionState(status)

  return (
    <div className="flex flex-col gap-2.5 px-5 py-3.5">
      <div className="flex items-center gap-3">
        {/* Flat icon — the brand mark is already recognizable, no need to
				    cage it in a bordered tile. */}
        <Icon className="size-4 shrink-0 text-foreground" />
        {/* One-line metadata: name · version · state — no sub-line. */}
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5 truncate text-sm">
          <span className="font-medium text-foreground">{status.name}</span>
          {status.version ? (
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
              {status.version}
            </span>
          ) : null}
          <span className="text-muted-foreground/40">·</span>
          <span className={cn("text-[12px]", state.tone)}>{state.label}</span>
        </div>
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
      </div>

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
    </div>
  )
}
