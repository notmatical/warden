import {
  Ban,
  Copy,
  Eye,
  MoreHorizontal,
  Plus,
  Trash2,
  Upload,
  Workflow as WorkflowIcon,
} from "lucide-react"
import { useEffect, useMemo, useRef } from "react"

import { CountChip } from "@/components/common/count-chip"
import {
  DataTable,
  DataTableEmpty,
  DataTableRow,
} from "@/components/common/data-table"
import { useConfirm } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { relativeTime } from "@/lib/time"
import { useAppStore } from "@/store/app-store"

import { StatusPill } from "./status"

const COLS =
  "grid grid-cols-[minmax(0,1fr)_120px_92px_44px] items-center gap-x-4"
const MENU_ITEM = "gap-2 text-[13px]"

/** Workflows scoped to one folder, shown on its dashboard so they live next to
 *  the folder's sessions — and a new one is created right where it'll run. */
export function FolderWorkflowsSection({ projectId }: { projectId: string }) {
  const workflowsMap = useAppStore((s) => s.workflows)
  const statuses = useAppStore((s) => s.workflowRunStatusById)
  const loadWorkflows = useAppStore((s) => s.loadWorkflows)
  const createWorkflow = useAppStore((s) => s.createWorkflow)
  const openWorkflow = useAppStore((s) => s.openWorkflow)
  const duplicateWorkflow = useAppStore((s) => s.duplicateWorkflow)
  const exportWorkflow = useAppStore((s) => s.exportWorkflow)
  const deleteWorkflow = useAppStore((s) => s.deleteWorkflow)
  const cancelWorkflow = useAppStore((s) => s.cancelWorkflow)
  const confirm = useConfirm()

  useEffect(() => {
    void loadWorkflows(projectId)
  }, [projectId, loadWorkflows])

  const rows = useMemo(
    () =>
      Object.values(workflowsMap)
        .filter((w) => w.projectId === projectId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [workflowsMap, projectId]
  )

  // Suppress the fall-through row click when a menu item is selected.
  const skipNextOpen = useRef(false)
  const runAction = (fn: () => void) => {
    skipNextOpen.current = true
    setTimeout(() => {
      skipNextOpen.current = false
    }, 350)
    fn()
  }

  const create = async () => {
    const wf = await createWorkflow(projectId, "New workflow")
    if (wf) openWorkflow(wf.id)
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex h-7 shrink-0 items-center gap-2">
        <h2 className="font-semibold text-base text-foreground">Workflows</h2>
        <CountChip>{rows.length}</CountChip>
        <div className="flex-1" />
        <Button size="sm" onClick={() => void create()} className="gap-1.5">
          <Plus className="size-3.5" />
          New workflow
        </Button>
      </div>

      <DataTable>
        {rows.length === 0 ? (
          <DataTableEmpty>
            No workflows in this folder yet — create one to orchestrate agents.
          </DataTableEmpty>
        ) : (
          rows.map((w) => {
            const st = statuses[w.id]
            const active = st === "running" || st === "paused"
            const onOpen = () => runAction(() => openWorkflow(w.id))
            const onDuplicate = () =>
              runAction(
                () =>
                  void duplicateWorkflow(w.id).then((c) => c && openWorkflow(c.id))
              )
            const onExport = () => runAction(() => void exportWorkflow(w.id))
            const onCancel = () => runAction(() => void cancelWorkflow(w.id))
            const onDelete = () =>
              runAction(async () => {
                if (
                  await confirm({
                    title: "Delete workflow?",
                    description: `"${w.name}" will be permanently deleted.`,
                    confirmLabel: "Delete",
                    destructive: true,
                  })
                ) {
                  void deleteWorkflow(w.id)
                }
              })
            return (
              <DataTableRow
                key={w.id}
                className={COLS}
                onClick={() => {
                  if (skipNextOpen.current) return
                  openWorkflow(w.id)
                }}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <WorkflowIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium text-foreground">
                    {w.name}
                  </span>
                </div>
                {st ? (
                  <StatusPill status={st} pulse={st === "running"} />
                ) : (
                  <span className="text-muted-foreground/40 text-xs">—</span>
                )}
                <span className="text-muted-foreground text-xs tabular-nums">
                  {relativeTime(w.updatedAt)}
                </span>
                <div className="flex items-center justify-end">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Workflow actions"
                        onClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      {active ? (
                        <>
                          <DropdownMenuItem
                            onSelect={onCancel}
                            className={MENU_ITEM}
                          >
                            <Ban />
                            Cancel run
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                        </>
                      ) : null}
                      <DropdownMenuItem onSelect={onOpen} className={MENU_ITEM}>
                        <Eye />
                        Open
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={onDuplicate}
                        className={MENU_ITEM}
                      >
                        <Copy />
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={onExport}
                        className={MENU_ITEM}
                      >
                        <Upload />
                        Export
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={onDelete}
                        className={MENU_ITEM}
                      >
                        <Trash2 />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </DataTableRow>
            )
          })
        )}
      </DataTable>
    </section>
  )
}
