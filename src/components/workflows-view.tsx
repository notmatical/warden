import {
  Ban,
  ChevronDown,
  Copy,
  Download,
  Eye,
  MoreHorizontal,
  Plus,
  Trash2,
  Upload,
  Workflow as WorkflowIcon,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  DataTable,
  DataTableEmpty,
  DataTableRow,
} from "@/components/common/data-table"
import { useConfirm } from "@/components/confirm-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { readClipboard } from "@/lib/clipboard"
import * as ipc from "@/lib/ipc"
import { relativeTime } from "@/lib/time"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"
import type { Project } from "@/types"
import type { RunStatus } from "@/types/workflow"

const COLS =
  "grid grid-cols-[minmax(0,1fr)_minmax(0,160px)_120px_96px_44px] items-center gap-x-4"

/** Tighter rows for the workflow action menus (kebab + right-click). */
const MENU_ITEM = "gap-2 text-[13px]"

/** Filter-bar control surface — subtle outline + light fill, shared by the
 *  search input and status dropdown so they read identically. */
const FILTER_SURFACE = "border-border/60 bg-input/50 dark:bg-input/50"

const STATUS: Record<RunStatus, { label: string; dot: string; pill: string }> =
  {
    running: {
      label: "Running",
      dot: "bg-blue-500",
      pill: "bg-blue-500/10 text-blue-400 ring-blue-500/30",
    },
    paused: {
      label: "Paused",
      dot: "bg-amber-500",
      pill: "bg-amber-500/10 text-amber-400 ring-amber-500/30",
    },
    pending: {
      label: "Pending",
      dot: "bg-muted-foreground/40",
      pill: "bg-muted/60 text-muted-foreground ring-border",
    },
    completed: {
      label: "Completed",
      dot: "bg-emerald-500",
      pill: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/30",
    },
    failed: {
      label: "Failed",
      dot: "bg-red-500",
      pill: "bg-red-500/10 text-red-400 ring-red-500/30",
    },
    canceled: {
      label: "Canceled",
      dot: "bg-muted-foreground/40",
      pill: "bg-muted/50 text-muted-foreground ring-border",
    },
  }

/** Statuses a run actually settles into, in filter order. `pending` is a
 *  sub-second transient and `paused` only occurs with Gate nodes, so neither is
 *  offered as a filter (the STATUS map above still renders them if they appear). */
const STATUS_ORDER: RunStatus[] = ["running", "completed", "failed", "canceled"]

function StatusPill({ status }: { status: RunStatus | undefined }) {
  const s = status ? STATUS[status] : undefined
  if (!s) return <span className="text-muted-foreground/40 text-xs">—</span>
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-0.5 font-medium text-[11px] ring-1 ring-inset",
        s.pill
      )}
    >
      <span className={cn("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  )
}

/** Global Workflows destination — every workflow across all projects in a
 *  Vercel-style data table with search + status filters. */
export function WorkflowsView() {
  const workflowsMap = useAppStore((s) => s.workflows)
  const statuses = useAppStore((s) => s.workflowRunStatusById)
  const loadAllWorkflows = useAppStore((s) => s.loadAllWorkflows)
  const createWorkflow = useAppStore((s) => s.createWorkflow)
  const openWorkflow = useAppStore((s) => s.openWorkflow)
  const duplicateWorkflow = useAppStore((s) => s.duplicateWorkflow)
  const exportWorkflow = useAppStore((s) => s.exportWorkflow)
  const importWorkflow = useAppStore((s) => s.importWorkflow)
  const deleteWorkflow = useAppStore((s) => s.deleteWorkflow)
  const cancelWorkflow = useAppStore((s) => s.cancelWorkflow)
  const activeGroupId = useAppStore((s) => s.activeGroupId)
  const activeRoots = useAppStore((s) =>
    activeGroupId ? s.rootsByGroup[activeGroupId] : undefined
  )
  const confirm = useConfirm()

  // A dropdown-item select can "fall through" as a click on the row beneath the
  // (now-closed) menu — suppress that one open so row actions don't also open it.
  const skipNextOpen = useRef(false)
  const runAction = (fn: () => void) => {
    skipNextOpen.current = true
    setTimeout(() => {
      skipNextOpen.current = false
    }, 350)
    fn()
  }

  const [projects, setProjects] = useState<Project[]>([])
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<Set<RunStatus>>(
    () => new Set(STATUS_ORDER)
  )
  const [importOpen, setImportOpen] = useState(false)
  const [importCode, setImportCode] = useState("")
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    void loadAllWorkflows()
    void ipc
      .listProjects()
      .then(setProjects)
      .catch(() => {})
  }, [loadAllWorkflows])

  const projectName = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p.name]))
    return (id: string) => map.get(id) ?? "—"
  }, [projects])

  // Count/compare against STATUS_ORDER membership (not raw set size) so stale
  // entries — e.g. a status removed from STATUS_ORDER — can't misrender.
  const selectedStatusCount = STATUS_ORDER.filter((s) =>
    statusFilter.has(s)
  ).length
  const allStatuses = selectedStatusCount === STATUS_ORDER.length
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = Object.values(workflowsMap).filter((w) => {
      if (q && !w.name.toLowerCase().includes(q)) return false
      // All selected ⇒ no status filter (never-run workflows show too). A
      // subset narrows to those statuses, dropping never-run ones.
      if (!allStatuses) {
        const st = statuses[w.id]
        if (!st || !statusFilter.has(st)) return false
      }
      return true
    })

    return filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [workflowsMap, statuses, search, statusFilter, allStatuses])

  const toggleStatus = (s: RunStatus, on: boolean) =>
    setStatusFilter((prev) => {
      const next = new Set(prev)
      if (on) next.add(s)
      else next.delete(s)
      return next
    })

  const newProject = activeRoots?.[0]?.id ?? projects[0]?.id
  const create = async () => {
    if (!newProject) return
    const wf = await createWorkflow(newProject, "New workflow")
    if (wf) openWorkflow(wf.id)
  }

  const runImport = async () => {
    if (!newProject || !importCode.trim() || importing) return
    setImporting(true)
    const wf = await importWorkflow(newProject, importCode)
    setImporting(false)
    if (wf) {
      setImportOpen(false)
      setImportCode("")
      openWorkflow(wf.id)
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div>
          <h1 className="font-medium text-foreground">Workflows</h1>
          <p className="text-muted-foreground text-xs">
            {Object.keys(workflowsMap).length} across all projects
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setImportCode("")
              setImportOpen(true)
            }}
            disabled={!newProject}
          >
            <Download className="size-4" />
            Import
          </Button>
          <Button onClick={() => void create()} disabled={!newProject}>
            <Plus className="size-4" />
            New workflow
          </Button>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search workflows…"
          className={cn("h-8 w-56", FILTER_SURFACE)}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="sm"
              className={cn(
                "h-8 gap-2 hover:bg-input/70 dark:hover:bg-input/70",
                FILTER_SURFACE
              )}
            >
              <span className="flex items-center">
                {STATUS_ORDER.filter((s) => statusFilter.has(s))
                  .slice(0, 4)
                  .map((s, i) => (
                    <span
                      key={s}
                      className={cn(
                        "size-2 rounded-full ring-2 ring-background",
                        STATUS[s].dot,
                        i > 0 && "-ml-1"
                      )}
                    />
                  ))}
              </span>
              Status
              <Badge
                variant="secondary"
                className="h-[18px] justify-center rounded-[5px] px-1 font-mono text-[10px] tabular-nums"
              >
                {selectedStatusCount}/{STATUS_ORDER.length}
              </Badge>
              <ChevronDown className="size-3.5 text-muted-foreground/60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {STATUS_ORDER.map((s) => (
              <DropdownMenuCheckboxItem
                key={s}
                checked={statusFilter.has(s)}
                onCheckedChange={(c) => toggleStatus(s, c === true)}
                onSelect={(e) => e.preventDefault()}
                className="gap-2 text-[13px]"
              >
                <span className={cn("size-2 rounded-full", STATUS[s].dot)} />
                {STATUS[s].label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <DataTable>
          {rows.length === 0 ? (
            <DataTableEmpty>
              {search || !allStatuses
                ? "No workflows match your filters."
                : "No workflows yet — create one to orchestrate agents."}
            </DataTableEmpty>
          ) : (
            rows.map((w) => {
              const st = statuses[w.id]
              const active = st === "running" || st === "paused"
              const onCancel = () => runAction(() => void cancelWorkflow(w.id))
              const onOpen = () => runAction(() => openWorkflow(w.id))
              const onDuplicate = () =>
                runAction(
                  () =>
                    void duplicateWorkflow(w.id).then(
                      (c) => c && openWorkflow(c.id)
                    )
                )
              const onExport = () => runAction(() => void exportWorkflow(w.id))
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
                <ContextMenu key={w.id}>
                  <ContextMenuTrigger asChild>
                    <DataTableRow
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
                      <span className="truncate text-muted-foreground text-xs">
                        {projectName(w.projectId)}
                      </span>
                      <StatusPill status={statuses[w.id]} />
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {relativeTime(w.updatedAt)}
                      </span>
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
                          <DropdownMenuItem
                            onSelect={onOpen}
                            className={MENU_ITEM}
                          >
                            <Eye />
                            View
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
                    </DataTableRow>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-40">
                    {active ? (
                      <>
                        <ContextMenuItem
                          onSelect={onCancel}
                          className={MENU_ITEM}
                        >
                          <Ban />
                          Cancel run
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                      </>
                    ) : null}
                    <ContextMenuItem onSelect={onOpen} className={MENU_ITEM}>
                      <Eye />
                      View
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={onDuplicate}
                      className={MENU_ITEM}
                    >
                      <Copy />
                      Duplicate
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={onExport} className={MENU_ITEM}>
                      <Upload />
                      Export
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      variant="destructive"
                      onSelect={onDelete}
                      className={MENU_ITEM}
                    >
                      <Trash2 />
                      Delete
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              )
            })
          )}
        </DataTable>
      </div>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import workflow</DialogTitle>
            <DialogDescription>
              Paste a workflow code exported from Warden. It'll be added as a
              new workflow{newProject ? ` in ${projectName(newProject)}` : ""}.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={importCode}
            onChange={(e) => setImportCode(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault()
                void runImport()
              }
            }}
            placeholder="warden-wf-…"
            rows={5}
            // biome-ignore lint/a11y/noAutofocus: paste target in a modal
            autoFocus
            className="max-h-48 overflow-y-auto break-all font-mono text-xs"
          />
          <DialogFooter className="sm:justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void readClipboard().then((t) => t && setImportCode(t))
              }}
            >
              Paste from clipboard
            </Button>
            <Button
              size="sm"
              onClick={() => void runImport()}
              disabled={!importCode.trim() || importing || !newProject}
            >
              {importing ? "Importing…" : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
