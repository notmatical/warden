import { Check, ChevronDown, FolderOpen } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Omnibox } from "@/components/omnibox"
import { useAppStore } from "@/store/app-store"

function WorkspaceSwitcher() {
  const workspaces = useAppStore((s) => s.workspaces)
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const selectWorkspace = useAppStore((s) => s.selectWorkspace)
  const openWorkspace = useAppStore((s) => s.openWorkspace)

  const active = workspaces.find((w) => w.id === activeWorkspaceId)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-8 max-w-56 gap-1.5 px-2 font-normal text-muted-foreground hover:text-foreground"
        >
          <FolderOpen className="size-4" />
          <span className="truncate">
            {active ? active.name : "Open workspace"}
          </span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {workspaces.length > 0 && (
          <>
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            {workspaces.map((workspace) => (
              <DropdownMenuItem
                key={workspace.id}
                onSelect={() => void selectWorkspace(workspace.id)}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{workspace.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {workspace.path}
                  </span>
                </span>
                {workspace.id === activeWorkspaceId && (
                  <Check className="ml-auto" />
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={() => void openWorkspace()}>
          <FolderOpen />
          Open folder…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Topbar() {
  return (
    <header
      data-tauri-drag-region
      className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 px-4"
    >
      <WorkspaceSwitcher />
      <div className="ml-1 flex-1">
        <Omnibox />
      </div>
    </header>
  )
}
