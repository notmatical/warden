import { PanelLeft } from "lucide-react"

import { CliUpdates } from "@/components/cli-updates"
import { GithubButton } from "@/components/github-button"
import { OpenInButtons } from "@/components/open-in-buttons"
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
      className="shrink-0 text-muted-foreground hover:text-foreground"
    >
      <PanelLeft />
    </Button>
  )
}

/** The full-width window titlebar. The left cluster (sidebar toggle) and right
 *  cluster (global actions + window controls) stay interactive; only the bare
 *  middle is the drag region. On macOS we reserve space for the native traffic
 *  lights; on Windows/Linux we render our own controls (native decorations off). */
export function Titlebar() {
  // The active session's working directory, falling back to the group's first
  // root.
  const openPath = useAppStore((s) => {
    const session = s.activeTabId ? s.sessions[s.activeTabId] : undefined
    if (session) return session.workingDir
    const groupId = s.activeGroupId
    return groupId ? (s.rootsByGroup[groupId]?.[0]?.path ?? null) : null
  })

  return (
    <header className="flex h-(--header-height) shrink-0 items-stretch bg-background">
      <div
        className={cn("flex items-center gap-1 pr-2 pl-3", isMac && "pl-20")}
      >
        <SidebarToggle />
      </div>

      {/* Draggable region — the bare middle. Clusters stay interactive. */}
      <div data-tauri-drag-region className="flex-1" />

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
