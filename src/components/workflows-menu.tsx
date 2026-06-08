import { Plus, Workflow as WorkflowIcon } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAppStore } from "@/store/app-store"

/** Topbar entry to open or create a workflow for the active group's project. */
export function WorkflowsMenu() {
  const projectId = useAppStore((s) =>
    s.activeGroupId ? (s.rootsByGroup[s.activeGroupId]?.[0]?.id ?? null) : null
  )
  const workflows = useAppStore((s) => s.workflows)
  const loadWorkflows = useAppStore((s) => s.loadWorkflows)
  const createWorkflow = useAppStore((s) => s.createWorkflow)
  const openWorkflow = useAppStore((s) => s.openWorkflow)
  const [open, setOpen] = useState(false)

  if (!projectId) return null
  const list = Object.values(workflows).filter((w) => w.projectId === projectId)

  const create = async () => {
    const wf = await createWorkflow(projectId, "New workflow")
    if (wf) openWorkflow(wf.id)
    setOpen(false)
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) void loadWorkflows(projectId)
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Workflows"
              className="text-muted-foreground hover:text-foreground"
            >
              <WorkflowIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Workflows</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Workflows</DropdownMenuLabel>
        {list.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            No workflows yet
          </div>
        ) : (
          list.map((w) => (
            <DropdownMenuItem
              key={w.id}
              onSelect={() => openWorkflow(w.id)}
              className="truncate"
            >
              {w.name}
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <Plus className="size-3.5" />
          New workflow
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
