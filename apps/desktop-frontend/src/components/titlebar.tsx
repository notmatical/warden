import { useSidebar } from "@warden/ui/components/sidebar"
import { PanelLeft } from "lucide-react"

import { CliUpdates } from "@/components/cli-updates"
import { GithubButton } from "@/components/github-button"
import { OpenInButtons } from "@/components/open-in-buttons"
import { SessionTabs } from "@/components/session-tabs"
import { Button } from "@/components/ui/button"
import { WindowControls } from "@/components/window-controls"
import { isMac, isTauri } from "@/lib/platform"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"

function SidebarToggle() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const setCollapsed = useAppStore((s) => s.setSidebarCollapsed)
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setCollapsed(!collapsed)}
      aria-label="Toggle sidebar"
      title="Toggle sidebar (Ctrl+B)"
      className="shrink-0 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
    >
      <PanelLeft />
    </Button>
  )
}

/** The full-width window titlebar, drawn on the frame (bg-sidebar). It hosts
 *  the tab strip: the left cluster tracks the sidebar column's width so tabs
 *  start at the inset card's left edge and the active tab can merge into it.
 *  On macOS we reserve space for the native traffic lights; on Windows/Linux
 *  we render our own controls. */
export function Titlebar() {
  const { state } = useSidebar()

  // The active session's working directory, falling back to the group's first
  // root.
  const openPath = useAppStore((s) => {
    const session = s.activeTabId ? s.sessions[s.activeTabId] : undefined
    if (session) return session.workingDir
    const groupId = s.activeGroupId
    return groupId ? (s.rootsByGroup[groupId]?.[0]?.path ?? null) : null
  })

  return (
    // z-10 paints the tabs above the inset card's ring, which sits 1px outside
    // the card's box — otherwise it draws a hairline across the active tab's base.
    <header className="relative z-10 flex h-(--header-height) w-full shrink-0 items-stretch">
      <div
        className={cn(
          "flex shrink-0 items-center gap-1 pl-3 transition-[width] duration-200 ease-linear",
          isMac && "min-w-[6.5rem] pl-20",
          // Collapsed width = icon rail + its padding + the inset card's ms-2,
          // so the cluster's right edge tracks the card's left edge in both
          // states and the tabs' corner fillers always sit above the card.
          state === "collapsed"
            ? "w-[calc(var(--sidebar-width-icon)+(--spacing(6))+2px)]"
            : "w-(--sidebar-width)"
        )}
      >
        <SidebarToggle />
        <div data-tauri-drag-region className="h-full min-w-0 flex-1" />
      </div>

      <SessionTabs />

      <div className="flex items-center gap-1 px-2">
        <CliUpdates />
        <GithubButton path={openPath} />
        <div className="mx-0.5 h-4 w-px bg-border/60" />
        <OpenInButtons path={openPath} />
      </div>

      {isTauri && !isMac ? <WindowControls /> : null}
    </header>
  )
}
