import { openUrl } from "@tauri-apps/plugin-opener"
import {
  ChevronDown,
  ExternalLink,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  MoreHorizontal,
  Pin,
  PinOff,
  SquareTerminal,
  Tag,
  Trash2,
  Wrench,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { AgentProvidersIcon } from "@/components/agent-providers-icon"
import { CheckDot } from "@/components/common/check-dot"
import { CountChip } from "@/components/common/count-chip"
import {
  DataTable,
  DataTableEmpty,
  DataTableRow,
} from "@/components/common/data-table"
import {
  FILTER_SURFACE,
  FilterMenu,
  SwatchStack,
} from "@/components/common/filter-menu"
import { useConfirm } from "@/components/confirm-dialog"
import { LabelChip, LabelPicker, labelColor } from "@/components/label-picker"
import { PrHoverCard } from "@/components/pr-hover-card"
import { SessionFavicon } from "@/components/session-favicon"
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
import { BindLinearBanner } from "@/integrations/linear/components/bind-linear-banner"
import { FolderTasksSection } from "@/integrations/linear/components/folder-tasks-section"
import { useFolderLinearBinding } from "@/integrations/linear/hooks"
import * as ipc from "@/lib/ipc"
import { DEFAULT_CHAT_MODEL } from "@/lib/models"
import { NATIVE_PROVIDER_ICON, PROVIDER_ORDER } from "@/lib/provider-icons"
import { relativeTime } from "@/lib/time"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"
import { NATIVE_TITLE } from "@/store/shared"
import type { Label, Session, SessionKind, SessionStatus } from "@/types"

// Session · Labels · Branch · Status · Last active · actions.
const COLS =
  "grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,1fr)_108px_92px_60px] items-center gap-x-4"

const MENU_ITEM = "gap-2 text-[13px]"

/** Sessions rendered per infinite-scroll page. */
const PAGE = 15

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

/** A folder's dashboard: its sessions, and — when the repo is bound to a
 *  Linear team — its tasks. Header anchors where you are (group · folder ·
 *  path) plus live stats, and always offers session creation. */
export function FolderView({ projectId }: { projectId: string }) {
  const project = useAppStore((s) =>
    Object.values(s.rootsByGroup)
      .flat()
      .find((p) => p.id === projectId)
  )
  const groupNames = useAppStore((s) =>
    s.groups
      .filter((g) =>
        (s.rootsByGroup[g.id] ?? []).some((p) => p.id === projectId)
      )
      .map((g) => g.name)
      .join(" · ")
  )
  const runningCount = useAppStore(
    (s) =>
      Object.values(s.sessions).filter(
        (x) => x.projectId === projectId && x.status === "running"
      ).length
  )
  const createSession = useAppStore((s) => s.createSession)
  const createNativeSession = useAppStore((s) => s.createNativeSession)
  const providers = useAppStore((s) => s.providers)
  const nativeProviders = PROVIDER_ORDER.filter((id) =>
    providers.some((p) => p.id === id && p.authed)
  )
  const linear = useFolderLinearBinding(projectId)
  const [setupOpen, setSetupOpen] = useState(false)

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

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-6 p-6">
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/60 ring-1 ring-border/50">
            <FolderGit2 className="size-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-semibold text-foreground text-lg leading-tight">
              {project?.name ?? "Folder"}
            </h1>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground/70">
              {groupNames ? (
                <>
                  <span className="shrink-0 truncate">{groupNames}</span>
                  <span className="shrink-0 text-muted-foreground/40">·</span>
                </>
              ) : null}
              {project ? (
                <span className="truncate font-mono">{project.path}</span>
              ) : null}
            </div>
          </div>
          {runningCount > 0 ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-500/10 px-2 py-0.5 font-medium text-[11px] text-blue-400 ring-1 ring-blue-500/30 ring-inset">
              <span className="size-1.5 animate-pulse rounded-full bg-blue-500" />
              {runningCount} running
            </span>
          ) : null}
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
              {nativeProviders.length > 0 ? <DropdownMenuSeparator /> : null}
              {nativeProviders.map((id) => {
                const Icon = NATIVE_PROVIDER_ICON[id]
                return (
                  <DropdownMenuItem
                    key={id}
                    onSelect={() => void createNativeSession(projectId, id)}
                  >
                    <Icon />
                    Native {NATIVE_TITLE[id]}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {linear.phase === "unbound" ? (
          <BindLinearBanner
            projectId={projectId}
            onBound={() => void linear.refresh()}
          />
        ) : null}

        <OpenPrsSection projectId={projectId} />

        <SessionsSection projectId={projectId} />

        {linear.phase === "bound" && linear.binding ? (
          <FolderTasksSection
            projectId={projectId}
            binding={linear.binding}
            onBindingChanged={() => void linear.refresh()}
          />
        ) : null}
      </div>
    </div>
  )
}

// PR · Session · Branch · Last active · link.
const PR_COLS =
  "grid grid-cols-[110px_minmax(0,1.5fr)_minmax(0,1fr)_92px_36px] items-center gap-x-4"

/** Sessions with an open pull request, surfaced ahead of the full list.
 *  Click a row to jump to the session; the trailing link opens the PR. */
function OpenPrsSection({ projectId }: { projectId: string }) {
  const sessionsMap = useAppStore((s) => s.sessions)
  const openSession = useAppStore((s) => s.openSession)

  const rows = useMemo(
    () =>
      Object.values(sessionsMap)
        .filter(
          (s) =>
            s.projectId === projectId &&
            s.prNumber != null &&
            s.prState === "OPEN"
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [sessionsMap, projectId]
  )
  if (rows.length === 0) return null

  return (
    <section className="flex flex-col gap-3">
      <div className="flex h-7 shrink-0 items-center gap-2">
        <h2 className="font-semibold text-base text-foreground">
          Open pull requests
        </h2>
        <CountChip>{rows.length}</CountChip>
      </div>
      <DataTable>
        {rows.map((session) => (
          <DataTableRow
            key={session.id}
            className={PR_COLS}
            onClick={() => openSession(session.id)}
          >
            <PrHoverCard sessionId={session.id}>
              <span className="flex w-fit items-center gap-1.5 text-xs">
                <GitPullRequest className="size-3.5 shrink-0 text-emerald-500" />
                <span className="font-medium text-foreground tabular-nums">
                  #{session.prNumber}
                </span>
                <CheckDot status={session.prCheckStatus} />
              </span>
            </PrHoverCard>

            <span className="truncate font-medium text-[13px] text-foreground">
              {session.title}
            </span>

            {session.branch ? (
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
                <GitBranch className="size-3 shrink-0 opacity-60" />
                <span className="truncate font-mono">{session.branch}</span>
              </span>
            ) : (
              <span className="text-muted-foreground/40 text-xs">—</span>
            )}

            <span className="text-muted-foreground text-xs tabular-nums">
              {relativeTime(session.updatedAt)}
            </span>

            <div className="flex items-center justify-end">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`View pull request #${session.prNumber} on GitHub`}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (session.prUrl) void openUrl(session.prUrl)
                    }}
                    className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <ExternalLink className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>View pull request on GitHub</TooltipContent>
              </Tooltip>
            </div>
          </DataTableRow>
        ))}
      </DataTable>
    </section>
  )
}

/** Every session for one project (repo root). Click a row to open it;
 *  right-click or the kebab for pin/labels/delete. */
function SessionsSection({ projectId }: { projectId: string }) {
  const sessionsMap = useAppStore((s) => s.sessions)
  const openSession = useAppStore((s) => s.openSession)
  const deleteSession = useAppStore((s) => s.deleteSession)
  const setSessionPinned = useAppStore((s) => s.setSessionPinned)
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

  // Suppress the fall-through row click when a menu item is selected.
  const skipNextOpen = useRef(false)
  const runAction = (fn: () => void) => {
    skipNextOpen.current = true
    setTimeout(() => {
      skipNextOpen.current = false
    }, 350)
    fn()
  }

  // Long histories render incrementally: an in-table sentinel grows the limit
  // as it scrolls into view, so the dashboard stays light without a button.
  const [limit, setLimit] = useState(PAGE)
  const sentinelIo = useRef<IntersectionObserver | null>(null)
  // Callback ref + key={limit}: every bump remounts the sentinel, re-arming a
  // fresh observer that fires immediately if it is still in view (auto-fill).
  const observeSentinel = useCallback((el: HTMLDivElement | null) => {
    sentinelIo.current?.disconnect()
    sentinelIo.current = null
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((l) => l + PAGE)
      },
      { rootMargin: "240px" }
    )
    io.observe(el)
    sentinelIo.current = io
  }, [])

  const [search, setSearch] = useState("")
  // Empty selection = no filter, matching the shared FilterMenu convention.
  const [statusFilter, setStatusFilter] = useState<Set<string>>(() => new Set())
  const [labelFilter, setLabelFilter] = useState<Set<string>>(() => new Set())
  const allStatuses = statusFilter.size === 0

  const toggleIn = (
    set: (fn: (prev: Set<string>) => Set<string>) => void,
    value: string,
    on: boolean
  ) =>
    set((prev) => {
      const next = new Set(prev)
      if (on) next.add(value)
      else next.delete(value)
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
    <section className="flex flex-col gap-3">
      <div className="flex h-7 shrink-0 flex-wrap items-center gap-2">
        <h2 className="font-semibold text-base text-foreground">Sessions</h2>
        <CountChip>{rows.length}</CountChip>
        <div className="flex-1" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sessions…"
          className={cn("h-8 w-48", FILTER_SURFACE)}
        />
        <FilterMenu
          label="Status"
          icon={
            <SwatchStack
              swatches={STATUS_ORDER.map((s) => (
                <span
                  key={s}
                  className={cn("size-2.5 rounded-full", STATUS[s].dot)}
                />
              ))}
            />
          }
          options={STATUS_ORDER.map((s) => ({
            value: s,
            label: STATUS[s].label,
            swatch: (
              <span className={cn("size-2 rounded-full", STATUS[s].dot)} />
            ),
          }))}
          selected={statusFilter}
          onToggle={(v, on) => toggleIn(setStatusFilter, v, on)}
          onClear={() => setStatusFilter(new Set())}
        />
        <FilterMenu
          label="Labels"
          options={(labels ?? []).map((l) => ({
            value: l.id,
            label: l.name,
            swatch: (
              <span
                className={cn("size-2 rounded-full", labelColor(l.color).dot)}
              />
            ),
          }))}
          selected={labelFilter}
          onToggle={(v, on) => toggleIn(setLabelFilter, v, on)}
          onClear={() => setLabelFilter(new Set())}
        />
      </div>

      <DataTable>
        {rows.length === 0 ? (
          <DataTableEmpty>
            {search || !allStatuses || labelFilter.size > 0
              ? "No sessions match your filters."
              : "No sessions in this folder yet."}
          </DataTableEmpty>
        ) : (
          rows.slice(0, limit).map((session) => {
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
                  <ContextMenuItem onSelect={onTogglePin} className={MENU_ITEM}>
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
        {rows.length > limit ? (
          <div
            key={limit}
            ref={observeSentinel}
            className="flex items-center justify-center border-foreground/5 border-t px-4 py-2.5 text-muted-foreground/70 text-xs tabular-nums"
          >
            {limit} of {rows.length}
          </div>
        ) : null}
      </DataTable>
    </section>
  )
}
