import { ArrowUp, Loader2, X } from "lucide-react"
import { type ReactNode, useState } from "react"

import { Button } from "@/components/ui/button"
import { useAppUpdate } from "@/hooks/use-app-update"
import { useAppStore } from "@/store/app-store"

const DISMISS_KEY = "warden:dismissed-updates"

function readDismissed(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "{}")
  } catch {
    return {}
  }
}

/** The shared banner shell, above the settings button. */
function BannerCard({
  title,
  description,
  actionLabel,
  onAction,
  busy,
  onDismiss,
}: {
  title: string
  description: ReactNode
  actionLabel: string
  onAction: () => void
  busy: boolean
  onDismiss?: () => void
}) {
  return (
    <div className="mb-2 rounded-lg border border-border/60 bg-muted/40 p-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-md bg-foreground/10 text-foreground/70">
          <ArrowUp className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
        {onDismiss ? (
          <button
            type="button"
            aria-label="Dismiss"
            onClick={onDismiss}
            className="-mt-0.5 -mr-0.5 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
      <Button
        size="sm"
        disabled={busy}
        onClick={onAction}
        className="mt-2.5 h-7 w-full gap-1.5 bg-foreground text-xs text-background hover:bg-foreground/90"
      >
        {busy ? (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            Updating…
          </>
        ) : (
          actionLabel
        )}
      </Button>
    </div>
  )
}

/** Surfaces an available update above the settings button. A Warden app update
 *  (Tauri updater) takes priority — it's how users get new features; CLI-provider
 *  updates fall back below it. Dismissals are remembered per version. */
export function UpdateBanner() {
  const { update: appUpdate, installing, install } = useAppUpdate()
  const [appDismissed, setAppDismissed] = useState<string | null>(null)

  const providers = useAppStore((s) => s.providers)
  const updateProvider = useAppStore((s) => s.updateProvider)
  const [dismissed, setDismissed] = useState(readDismissed)
  const [updating, setUpdating] = useState(false)

  // Warden self-update first.
  if (appUpdate && appDismissed !== appUpdate.version) {
    return (
      <BannerCard
        title="Update available"
        description={`Warden ${appUpdate.version} is ready — restart to get the latest features.`}
        actionLabel="Restart & update"
        onAction={() => void install()}
        busy={installing}
        onDismiss={() => setAppDismissed(appUpdate.version)}
      />
    )
  }

  // Otherwise, an available CLI-provider update.
  const pending = providers.find(
    (p) => p.updateAvailable && dismissed[p.id] !== (p.latestVersion ?? "")
  )
  if (!pending) return null

  const dismissProvider = () => {
    const next = { ...dismissed, [pending.id]: pending.latestVersion ?? "" }
    setDismissed(next)
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(next))
    } catch {
      // ignore storage failures
    }
  }

  const runProviderUpdate = async () => {
    setUpdating(true)
    await updateProvider(pending.id)
    setUpdating(false)
  }

  return (
    <BannerCard
      title="Update available"
      description={`${pending.name} ${pending.latestVersion} is ready to install.`}
      actionLabel="Update"
      onAction={() => void runProviderUpdate()}
      busy={updating}
      onDismiss={dismissProvider}
    />
  )
}
