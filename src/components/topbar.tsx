import { PanelLeft } from "lucide-react"

import { Omnibox } from "@/components/omnibox"
import { OpenInButtons } from "@/components/open-in-buttons"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/store/app-store"

export function Topbar() {
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)

  // The active session's working directory, falling back to the group's first
  // root.
  const openPath = useAppStore((s) => {
    const groupId = s.activeGroupId
    const activeSessionId = groupId
      ? s.activeSessionByGroup[groupId] ?? null
      : null
    const session = activeSessionId ? s.sessions[activeSessionId] : undefined
    if (session) return session.workingDir
    return groupId ? s.rootsByGroup[groupId]?.[0]?.path ?? null : null
  })

  return (
    <header
      data-tauri-drag-region
      className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 px-4"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={toggleSidebar}
        aria-label="Toggle sidebar"
        title="Toggle sidebar (Ctrl+B)"
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <PanelLeft />
      </Button>
      <div className="flex-1">
        <Omnibox />
      </div>
      <OpenInButtons path={openPath} />
    </header>
  )
}
