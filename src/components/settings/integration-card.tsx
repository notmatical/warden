import { Loader2, MoreHorizontal } from "lucide-react"
import type { ComponentType } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { ProviderSource, ProviderStatus } from "@/types"

import { connectionState, useToolInstall } from "./use-tool-install"

interface IntegrationCardProps {
  status: ProviderStatus
  icon: ComponentType<{ className?: string }>
  description: string
  onInstall: () => Promise<void>
  onUpdate: () => Promise<void>
  /** Set when the integration is CLI-backed (has managed/system source). */
  onSetSource?: (source: ProviderSource) => void
  onSignIn?: () => void
}

/** Source-preference kebab menu. Plain-English copy ("Let warden manage this"
 *  / "Use my system install") so users don't need to know what "source" means. */
function SourceMenu({
  status,
  onSetSource,
}: {
  status: ProviderStatus
  onSetSource: (source: ProviderSource) => void
}) {
  const systemDisabled = !status.systemDetected
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Install settings"
          title="Install settings"
          className="text-muted-foreground hover:text-foreground"
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">
          Install
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={status.source}
          onValueChange={(v) => onSetSource(v as ProviderSource)}
        >
          <DropdownMenuRadioItem value="managed" className="gap-2">
            <div className="flex min-w-0 flex-col">
              <span>Let warden manage this</span>
              <span className="text-[11px] text-muted-foreground">
                warden installs it and keeps it updated.
              </span>
            </div>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="system"
            disabled={systemDisabled}
            className="gap-2"
          >
            <div className="flex min-w-0 flex-col">
              <span>Use my system install</span>
              <span className="text-[11px] text-muted-foreground">
                {systemDisabled
                  ? "Not found on PATH."
                  : "Run the copy on your PATH; you handle updates."}
              </span>
            </div>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A styled 3rd-party integration tile for the Integrations grid. Brand logo
 *  + name read first, description below, state + actions at the bottom. The
 *  source preference (when CLI-backed) lives in a kebab menu so it doesn't
 *  intrude on the at-rest view. */
export function IntegrationCard({
  status,
  icon: Icon,
  description,
  onInstall,
  onUpdate,
  onSetSource,
  onSignIn,
}: IntegrationCardProps) {
  const { busy, progress, action } = useToolInstall({
    status,
    onInstall,
    onUpdate,
    onSignIn,
  })
  const state = connectionState(status)

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card p-4 transition-colors hover:border-border">
      {/* Brand */}
      <div className="flex items-center gap-2.5">
        <Icon className="size-5 shrink-0 text-foreground" />
        <span className="truncate text-sm font-semibold text-foreground">
          {status.name}
        </span>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>

      {/* State + actions — same font-size for everything on the row so the
			    dot/text/version all sit on the same baseline. */}
      <div className="mt-auto flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-baseline gap-1.5 truncate text-xs">
          <span className={cn(state.tone)}>{state.label}</span>
          {status.version ? (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="font-mono text-muted-foreground tabular-nums">
                {status.version}
              </span>
            </>
          ) : null}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {onSetSource ? (
            <SourceMenu status={status} onSetSource={onSetSource} />
          ) : null}
          {action && !progress ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={action.onClick}
              disabled={busy}
              className={cn(
                action.primary
                  ? "bg-foreground text-background hover:bg-foreground/90"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {busy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                action.label
              )}
            </Button>
          ) : null}
        </div>
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
