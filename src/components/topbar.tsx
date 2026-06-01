import { PanelLeft } from "lucide-react"

import { Omnibox } from "@/components/omnibox"
import { OpenInButtons } from "@/components/open-in-buttons"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/store/app-store"

export function Topbar() {
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)

  // The active session's working directory, falling back to the project root.
  const openPath = useAppStore((s) => {
    const session = s.activeSessionId ? s.sessions[s.activeSessionId] : undefined
    if (session) return session.workingDir
    return s.projects.find((w) => w.id === s.activeProjectId)?.path ?? null
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
