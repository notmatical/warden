import { Check, ChevronDown, FolderOpen, Shield } from "lucide-react"

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
        <Button variant="outline" className="max-w-52">
          <FolderOpen />
          <span className="truncate">{active ? active.name : "Workspace"}</span>
          <ChevronDown className="text-muted-foreground" />
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
    <header className="flex items-center gap-3 border-b border-border px-3 py-2">
      <div className="flex shrink-0 items-center gap-2 pr-1 font-semibold">
        <Shield className="size-4 text-primary" />
        <span>Warden</span>
      </div>
      <WorkspaceSwitcher />
      <Omnibox />
    </header>
  )
}
