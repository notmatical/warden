import {
  ChevronDown,
  ExternalLink,
  FolderGit2,
  GitBranch,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  SquareTerminal,
  Tag,
  Trash2,
  Wrench,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { AgentProvidersIcon } from "@/components/agent-providers-icon"
import {
  DataTable,
  DataTableEmpty,
  DataTableRow,
} from "@/components/common/data-table"
import { useConfirm } from "@/components/confirm-dialog"
import { ClaudeIcon, CodexIcon } from "@/components/icons/brand"
import { LabelChip, LabelPicker, labelColor } from "@/components/label-picker"
import { SessionFavicon } from "@/components/session-favicon"
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
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { WorktreeSetupDialog } from "@/components/worktree-setup-dialog"
import * as ipc from "@/lib/ipc"
import { DEFAULT_CHAT_MODEL } from "@/lib/models"
import { relativeTime } from "@/lib/time"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"
import type { Label, Session, SessionKind, SessionStatus } from "@/types"

// Session · Labels · Branch · Status · Last active · actions.
const COLS =
  "grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,1fr)_108px_92px_60px] items-center gap-x-4"

const MENU_ITEM = "gap-2 text-[13px]"

/** Filter-bar control surface — shared by search + status (matches Workflows). */
const FILTER_SURFACE = "border-border/60 bg-input/50 dark:bg-input/50"

const STATUS: Record<
  SessionStatus,
  { label: string; dot: string; pill: string }
> = {
  running: {
    label: "Running",
    dot: "bg-blue-500",
    pill: "bg-blue-500/10 text-blue-400 ring-blue-500/30",
  },
  idle: {
    label: "Idle",
    dot: "bg-muted-foreground/40",
    pill: "bg-muted/60 text-muted-foreground ring-border",
  },
  error: {
    label: "Error",
    dot: "bg-red-500",
    pill: "bg-red-500/10 text-red-400 ring-red-500/30",
  },
}
const STATUS_ORDER: SessionStatus[] = ["running", "idle", "error"]

function StatusBadge({ status }: { status: SessionStatus }) {
  const s = STATUS[status]
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-0.5 font-medium text-[11px] ring-1 ring-inset",
        s.pill
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          s.dot,
          status === "running" && "animate-pulse"
        )}
      />
      {s.label}
    </span>
  )
}

/** The model (agents) or launched CLI (terminals), shown under the title. */
function subtitle(session: Session): string {
  if (session.kind === "terminal") return session.terminalCommand ?? "Terminal"
  return session.model
}

/** A folder's session list — every session for one project (repo root). Click a
 *  row to open it; right-click or the kebab for pin/labels/delete. */
export function FolderView({ projectId }: { projectId: string }) {
  const project = useAppStore((s) =>
    Object.values(s.rootsByGroup)
      .flat()
      .find((p) => p.id === projectId)
  )
  const sessionsMap = useAppStore((s) => s.sessions)
  const openSession = useAppStore((s) => s.openSession)
  const deleteSession = useAppStore((s) => s.deleteSession)
  const setSessionPinned = useAppStore((s) => s.setSessionPinned)
  const createSession = useAppStore((s) => s.createSession)
  const createNativeSession = useAppStore((s) => s.createNativeSession)
  const claudeAuthed = useAppStore((s) =>
    s.providers.some((p) => p.id === "claude" && p.authed)
  )
  const codexAuthed = useAppStore((s) =>
    s.providers.some((p) => p.id === "codex" && p.authed)
  )
  const labels = useAppStore((s) => s.labelsByProject[projectId])
  const labelIdsBySession = useAppStore((s) => s.labelIdsBySession)
  const loadProjectLabels = useAppStore((s) => s.loadProjectLabels)
  const confirm = useConfirm()

  useEffect(() => {
    void loadProjectLabels(projectId)
  }, [projectId, loadProjectLabels])

  const labelsById = useMemo(
    () => new Map((labels ?? []).map((l) => [l.id, l])),
    [labels]
  )

  const newSession = (kind: SessionKind) => {
    void createSession({
      projectId,
      title: kind === "terminal" ? "Terminal" : "New session",
      model: DEFAULT_CHAT_MODEL,
      permissionMode: "bypassPermissions",
      role: "chat",
      kind,
    })
  }

  // Suppress the fall-through row click when a menu item is selected.
  const skipNextOpen = useRef(false)
  const runAction = (fn: () => void) => {
    skipNextOpen.current = true
    setTimeout(() => {
      skipNextOpen.current = false
    }, 350)
    fn()
  }

  const [setupOpen, setSetupOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<Set<SessionStatus>>(
    () => new Set(STATUS_ORDER)
  )
  const [labelFilter, setLabelFilter] = useState<Set<string>>(() => new Set())
  const selectedStatusCount = STATUS_ORDER.filter((s) =>
    statusFilter.has(s)
  ).length
  const allStatuses = selectedStatusCount === STATUS_ORDER.length

  const toggleStatus = (s: SessionStatus, on: boolean) =>
    setStatusFilter((prev) => {
      const next = new Set(prev)
      if (on) next.add(s)
      else next.delete(s)
      return next
    })

  const toggleLabelFilter = (id: string, on: boolean) =>
    setLabelFilter((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return Object.values(sessionsMap)
      .filter((s) => s.projectId === projectId)
      .filter((s) => !q || s.title.toLowerCase().includes(q))
      .filter((s) => allStatuses || statusFilter.has(s.status))
      .filter(
        (s) =>
          labelFilter.size === 0 ||
          (labelIdsBySession[s.id] ?? []).some((id) => labelFilter.has(id))
      )
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return b.updatedAt.localeCompare(a.updatedAt)
      })
  }, [
    sessionsMap,
    projectId,
    search,
    statusFilter,
    allStatuses,
    labelFilter,
    labelIdsBySession,
  ])

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex shrink-0 items-center gap-2.5">
        <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-medium text-foreground">
            {project?.name ?? "Folder"}
          </h1>
          {project ? (
            <p className="truncate font-mono text-[11px] text-muted-foreground/70">
              {project.path}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 text-muted-foreground text-xs">
          {rows.length} session{rows.length === 1 ? "" : "s"}
        </span>
        {project?.isGit ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Worktree commands"
                  onClick={() => setSetupOpen(true)}
                  className="shrink-0 text-muted-foreground"
                >
                  <Wrench className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Worktree setup/teardown commands
              </TooltipContent>
            </Tooltip>
            <WorktreeSetupDialog
              projectId={projectId}
              open={setupOpen}
              onOpenChange={setSetupOpen}
            />
          </>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="shrink-0 gap-1.5">
              <Plus className="size-4" />
              New session
              <ChevronDown className="size-3.5 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={() => newSession("agent")}>
              <AgentProvidersIcon />
              Agent session
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => newSession("terminal")}>
              <SquareTerminal />
              Terminal session
            </DropdownMenuItem>
            {claudeAuthed || codexAuthed ? <DropdownMenuSeparator /> : null}
            {claudeAuthed ? (
              <DropdownMenuItem
                onSelect={() => void createNativeSession(projectId, "claude")}
              >
                <ClaudeIcon />
                Native Claude
              </DropdownMenuItem>
            ) : null}
            {codexAuthed ? (
              <DropdownMenuItem
                onSelect={() => void createNativeSession(projectId, "codex")}
              >
                <CodexIcon />
                Native Codex
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sessions…"
          className={cn("h-8 w-56", FILTER_SURFACE)}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-8 gap-2 hover:bg-input/70 dark:hover:bg-input/70",
                FILTER_SURFACE
              )}
            >
              <span className="flex items-center">
                {STATUS_ORDER.filter((s) => statusFilter.has(s)).map((s, i) => (
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
          <DropdownMenuContent align="start" className="w-44">
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-8 gap-2 hover:bg-input/70 dark:hover:bg-input/70",
                FILTER_SURFACE
              )}
            >
              <Tag className="size-3.5 text-muted-foreground/70" />
              Labels
              {labelFilter.size > 0 ? (
                <Badge
                  variant="secondary"
                  className="h-[18px] justify-center rounded-[5px] px-1 font-mono text-[10px] tabular-nums"
                >
                  {labelFilter.size}
                </Badge>
              ) : null}
              <ChevronDown className="size-3.5 text-muted-foreground/60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {(labels ?? []).length === 0 ? (
              <div className="px-2 py-1.5 text-muted-foreground text-xs">
                No labels in this folder yet.
              </div>
            ) : (
              (labels ?? []).map((l) => (
                <DropdownMenuCheckboxItem
                  key={l.id}
                  checked={labelFilter.has(l.id)}
                  onCheckedChange={(c) => toggleLabelFilter(l.id, c === true)}
                  onSelect={(e) => e.preventDefault()}
                  className="gap-2 text-[13px]"
                >
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      labelColor(l.color).dot
                    )}
                  />
                  {l.name}
                </DropdownMenuCheckboxItem>
              ))
            )}
            {labelFilter.size > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => setLabelFilter(new Set())}
                  className="text-[13px] text-muted-foreground"
                >
                  Clear filter
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <DataTable>
          {rows.length === 0 ? (
            <DataTableEmpty>
              {search || !allStatuses || labelFilter.size > 0
                ? "No sessions match your filters."
                : "No sessions in this folder yet."}
            </DataTableEmpty>
          ) : (
            rows.map((session) => {
              const attached = labelIdsBySession[session.id] ?? []
              const chips = attached
                .map((id) => labelsById.get(id))
                .filter((l): l is Label => !!l)
              const onOpen = () => runAction(() => openSession(session.id))
              const onTogglePin = () =>
                runAction(
                  () => void setSessionPinned(session.id, !session.pinned)
                )
              const onDelete = () =>
                runAction(async () => {
                  // Name what deletion destroys: dirty files / unmerged
                  // commits mean the worktree+branch teardown loses work.
                  const check = await ipc
                    .sessionDeleteCheck(session.id)
                    .catch(() => null)
                  const risks: string[] = []
                  if (check?.dirtyFiles) {
                    risks.push(
                      `${check.dirtyFiles} file${check.dirtyFiles === 1 ? "" : "s"} of uncommitted changes`
                    )
                  }
                  if (check?.unmergedCommits) {
                    risks.push(
                      `${check.unmergedCommits} unmerged commit${check.unmergedCommits === 1 ? "" : "s"}`
                    )
                  }
                  if (
                    await confirm({
                      title:
                        risks.length > 0
                          ? "Delete session and unsaved work?"
                          : "Delete session?",
                      description:
                        risks.length > 0
                          ? `"${session.title}" will be permanently deleted. Its worktree still holds ${risks.join(" and ")} — deleting removes the worktree and its branch, and that work is lost.`
                          : `"${session.title}" and its history will be permanently deleted.`,
                      confirmLabel: "Delete",
                      destructive: true,
                    })
                  ) {
                    void deleteSession(session.id)
                  }
                })
              return (
                <ContextMenu key={session.id}>
                  <ContextMenuTrigger asChild>
                    <DataTableRow
                      className={COLS}
                      onClick={() => {
                        if (skipNextOpen.current) return
                        openSession(session.id)
                      }}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        {session.pinned ? (
                          <Pin className="size-3 shrink-0 rotate-45 fill-current text-muted-foreground/70" />
                        ) : null}
                        <SessionFavicon
                          kind={session.kind}
                          backend={session.backend}
                          status={session.status}
                          terminalCommand={session.terminalCommand}
                          className="size-[18px] shrink-0"
                        />
                        <div className="flex min-w-0 flex-col leading-tight">
                          <span className="truncate font-medium text-[13px] text-foreground">
                            {session.title}
                          </span>
                          <span className="truncate text-[11px] text-muted-foreground/70">
                            {subtitle(session)}
                          </span>
                        </div>
                      </div>

                      {/* Labels — packed wrap (no awkward gaps from short chips),
                          capped at 6 with a +N overflow badge. */}
                      {chips.length > 0 ? (
                        <div className="flex flex-wrap content-center items-center gap-1">
                          {chips.slice(0, 6).map((l) => (
                            <LabelChip key={l.id} label={l} />
                          ))}
                          {chips.length > 6 ? (
                            <span className="inline-flex items-center rounded-md bg-muted/60 px-2 py-0.5 font-medium text-[11px] text-muted-foreground tabular-nums ring-1 ring-border ring-inset">
                              +{chips.length - 6}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span />
                      )}

                      {session.branch ? (
                        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
                          <GitBranch className="size-3 shrink-0 opacity-60" />
                          <span className="truncate font-mono">
                            {session.branch}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40 text-xs">
                          —
                        </span>
                      )}

                      <StatusBadge status={session.status} />

                      <span className="text-muted-foreground text-xs tabular-nums">
                        {relativeTime(session.updatedAt)}
                      </span>

                      <div className="flex items-center justify-end gap-0.5">
                        <LabelPicker
                          projectId={projectId}
                          sessionId={session.id}
                          attached={attached}
                        >
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Edit labels"
                            onClick={(e) => e.stopPropagation()}
                            className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                          >
                            <Tag className="size-3.5" />
                          </Button>
                        </LabelPicker>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Session actions"
                              onClick={(e) => e.stopPropagation()}
                              className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40">
                            <DropdownMenuItem
                              onSelect={onOpen}
                              className={MENU_ITEM}
                            >
                              <ExternalLink />
                              Open
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={onTogglePin}
                              className={MENU_ITEM}
                            >
                              {session.pinned ? <PinOff /> : <Pin />}
                              {session.pinned ? "Unpin" : "Pin to top"}
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
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-40">
                    <ContextMenuItem onSelect={onOpen} className={MENU_ITEM}>
                      <ExternalLink />
                      Open
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={onTogglePin}
                      className={MENU_ITEM}
                    >
                      {session.pinned ? <PinOff /> : <Pin />}
                      {session.pinned ? "Unpin" : "Pin to top"}
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
    </div>
  )
}
