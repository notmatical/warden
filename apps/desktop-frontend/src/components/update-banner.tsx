import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@warden/ui/components/sidebar"
import { ArrowUp, Loader2, X } from "lucide-react"
import { type ReactNode, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAppUpdate } from "@/hooks/use-app-update"

/** The banner's inner content — shared between the expanded card and the
 *  collapsed rail's popover. */
function BannerBody({
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
    <>
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
    </>
  )
}

/** The shared banner shell, above the settings button. Expanded it's an inline
 *  card; in the collapsed rail it shrinks to an icon button whose popover holds
 *  the same content. */
function BannerCard(props: {
  title: string
  description: ReactNode
  actionLabel: string
  onAction: () => void
  busy: boolean
  onDismiss?: () => void
}) {
  const { state, isMobile } = useSidebar()

  if (state === "collapsed" && !isMobile) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <SidebarMenuButton
                    aria-label={props.title}
                    className="text-muted-foreground hover:text-foreground data-open:bg-sidebar-accent data-open:text-foreground"
                  >
                    {props.busy ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <ArrowUp />
                    )}
                    <span>{props.title}</span>
                  </SidebarMenuButton>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="right">{props.title}</TooltipContent>
            </Tooltip>
            <PopoverContent
              side="right"
              align="end"
              sideOffset={12}
              className="w-64 p-3"
            >
              <BannerBody {...props} />
            </PopoverContent>
          </Popover>
          {/* Anchored off the icon's left edge so it stays put while the
              sidebar's width animates. */}
          <span className="pointer-events-none absolute top-1 left-6 size-1.5 rounded-full bg-blue-500" />
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  // Fixed at the expanded footer's inner width (sidebar minus the floating
  // container's and the footer's padding): the open/close animation reveals
  // the card edge-on instead of reflowing its text.
  return (
    <div className="mb-2 w-[calc(var(--sidebar-width)-2rem)] rounded-lg border border-border/60 bg-muted/40 p-3">
      <BannerBody {...props} />
    </div>
  )
}

/** Surfaces an available Warden app update (Tauri updater) above the settings
 *  button — agent CLI updates live in the titlebar's CliUpdates control. */
export function UpdateBanner() {
  const { update, installing, install } = useAppUpdate()
  const [dismissed, setDismissed] = useState<string | null>(null)

  if (!update || dismissed === update.version) return null

  return (
    <BannerCard
      title="Update available"
      description={`Warden ${update.version} is ready. Restart to get the latest features.`}
      actionLabel="Restart & update"
      onAction={() => void install()}
      busy={installing}
      onDismiss={() => setDismissed(update.version)}
    />
  )
}
