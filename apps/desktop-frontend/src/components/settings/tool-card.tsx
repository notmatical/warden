import { Button } from "@warden/ui/components/button"
import { ArrowRight } from "lucide-react"
import type { ComponentType } from "react"

import {
  type CardStateKind,
  SettingsCard,
} from "@/components/settings/settings-card"
import { cn } from "@/lib/utils"
import type { ProviderSource, ProviderStatus } from "@/types"

import { useToolInstall } from "./use-tool-install"

function toolState(status: ProviderStatus): {
  kind: CardStateKind
  label: string
} {
  if (!status.installed) return { kind: "off", label: "Not installed" }
  if (!status.authed) return { kind: "warn", label: "Not signed in" }
  return { kind: "ok", label: "Connected" }
}

/** A two-state source picker (Managed / warden's copy vs System / PATH). */
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
    <div className="flex w-fit rounded-lg bg-muted/70 p-0.5">
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

/** A managed-CLI card (agent providers, GitHub CLI). Status sits in the header;
 *  the footer carries the one action that matters — a full-width Install / Sign
 *  in / Update CTA — or, when connected, the labeled source control. */
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
  const state = toolState(status)
  const updatePending = status.installed && status.updateAvailable
  // Install / Sign in are the card's headline action; Update rides the footer
  // so a working tool still reads as connected.
  const primary = action && action.label !== "Update" ? action : null

  return (
    <SettingsCard
      icon={icon}
      present={status.installed}
      name={status.name}
      version={status.version}
      description={description}
      statusKind={state.kind}
      statusLabel={state.label}
    >
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
      ) : updatePending ? (
        <Button size="sm" onClick={runUpdate} loading={busy} className="w-full">
          Update
          {status.version && status.latestVersion ? (
            <span className="font-mono text-[11px] opacity-80">
              v{status.version.replace(/^v/, "")} → v
              {status.latestVersion.replace(/^v/, "")}
            </span>
          ) : null}
        </Button>
      ) : (
        <div className="flex min-h-7 items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">Source</span>
          <SourcePicker status={status} onSetSource={onSetSource} />
        </div>
      )}
    </SettingsCard>
  )
}
