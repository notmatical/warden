import {
  ChevronRight,
  CircleDot,
  FolderGit2,
  FolderPlus,
  Layers,
  ListTodo,
  Pencil,
  Plus,
  Settings2,
  SquareTerminal,
  Trash2,
  Workflow as WorkflowIcon,
} from "lucide-react"
import { type KeyboardEvent, type ReactNode, useEffect, useState } from "react"

import { AgentProvidersIcon } from "@/components/agent-providers-icon"
import { useConfirm } from "@/components/confirm-dialog"
import { ClaudeIcon, CodexIcon, GitHubIcon } from "@/components/icons/brand"
import { ReviewPrDialog } from "@/components/review-pr-dialog"
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  Sidebar as SidebarRoot,
} from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { UpdateBanner } from "@/components/update-banner"
import { DEFAULT_CHAT_MODEL } from "@/lib/models"
import { cn } from "@/lib/utils"
import {
  folderTabId,
  ISSUES_TAB_ID,
  TASKS_TAB_ID,
  WORKFLOWS_TAB_ID,
} from "@/lib/viewport"
import { useAppStore } from "@/store/app-store"
import type { Group, Project, SessionKind } from "@/types"

// Keep shadcn's left connector line + indent, but drop the right margin/padding
// (default `mx-3.5 px-2.5`) so sub-rows reach the same right edge as the group
// above — their hover actions then align with the group's. Tighten the rhythm.
const SUB_CLASS = "mr-0 gap-0.5 pr-0"

// A plain icon with a hover tint — no button chrome.
const ROW_ICON =
  "flex size-5 items-center justify-center text-sidebar-foreground/50 transition-colors hover:text-sidebar-foreground [&>svg]:size-4"

/**
 * A right-aligned row action that reveals on hover. It fades in a gradient over
 * the row so the icon stays legible even when the name is long, and stays
 * visible while a menu it triggers is open.
 */
function RowAction({
  scope,
  children,
}: {
  scope: "item" | "sub-item"
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        // Anchored to the row's top with the row's height so it stays on the
        // name row even when the item is expanded. Solid row-colored backing
        // hides the name's tail; a short gradient strip softens the cut-off.
        "absolute top-0 right-0 flex items-center gap-0.5 bg-sidebar pr-1 pl-1.5 opacity-0 transition-opacity",
        "before:pointer-events-none before:absolute before:inset-y-0 before:right-full before:w-8 before:bg-gradient-to-l before:from-sidebar before:to-transparent",
        "has-data-[state=open]:opacity-100",
        scope === "item"
          ? "h-8 group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100"
          : "h-7 group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:opacity-100"
      )}
    >
      {children}
    </div>
  )
}

function RootRow({ groupId, project }: { groupId: string; project: Project }) {
  const createSession = useAppStore((s) => s.createSession)
  const createNativeSession = useAppStore((s) => s.createNativeSession)
  const removeRoot = useAppStore((s) => s.removeRoot)
  const openTab = useAppStore((s) => s.openTab)
  const active = useAppStore((s) => s.activeTabId === folderTabId(project.id))
  const claudeAuthed = useAppStore((s) =>
    s.providers.some((p) => p.id === "claude" && p.authed)
  )
  const codexAuthed = useAppStore((s) =>
    s.providers.some((p) => p.id === "codex" && p.authed)
  )

  const [reviewOpen, setReviewOpen] = useState(false)

  const newSession = async (kind: SessionKind) => {
    await createSession({
      projectId: project.id,
      title: kind === "terminal" ? "Terminal" : "New session",
      model: DEFAULT_CHAT_MODEL,
      permissionMode: "bypassPermissions",
      role: "chat",
      kind,
    })
  }

  return (
    <SidebarMenuSubItem>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <SidebarMenuSubButton
            asChild
            isActive={active}
            className="w-full cursor-default text-left text-sidebar-foreground/70 hover:bg-transparent hover:text-sidebar-foreground active:bg-transparent data-[active=true]:bg-transparent data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground"
          >
            <button
              type="button"
              onClick={() => openTab(folderTabId(project.id))}
              title={project.path}
            >
              <FolderGit2 className="opacity-70" />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
            </button>
          </SidebarMenuSubButton>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-44">
          <ContextMenuItem
            variant="destructive"
            onSelect={() => void removeRoot(groupId, project.id)}
          >
            <Trash2 />
            Remove from group
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <DropdownMenu>
        <RowAction scope="sub-item">
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`New session in ${project.name}`}
                  className={ROW_ICON}
                >
                  <Plus />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">New session</TooltipContent>
          </Tooltip>
        </RowAction>
        <DropdownMenuContent align="start" className="w-40">
          <DropdownMenuItem onSelect={() => void newSession("agent")}>
            <AgentProvidersIcon />
            Agent session
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void newSession("terminal")}>
            <SquareTerminal />
            Terminal session
          </DropdownMenuItem>
          {claudeAuthed || codexAuthed ? <DropdownMenuSeparator /> : null}
          {claudeAuthed ? (
            <DropdownMenuItem
              onSelect={() => void createNativeSession(project.id, "claude")}
            >
              <ClaudeIcon />
              Native Claude
            </DropdownMenuItem>
          ) : null}
          {codexAuthed ? (
            <DropdownMenuItem
              onSelect={() => void createNativeSession(project.id, "codex")}
            >
              <CodexIcon />
              Native Codex
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setReviewOpen(true)}>
            <GitHubIcon />
            Review a PR…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ReviewPrDialog
        projectId={project.id}
        open={reviewOpen}
        onOpenChange={setReviewOpen}
      />
    </SidebarMenuSubItem>
  )
}

function GroupRow({
  group,
  active,
  expanded,
  onToggle,
}: {
  group: Group
  active: boolean
  expanded: boolean
  onToggle: () => void
}) {
  const roots = useAppStore((s) => s.rootsByGroup[group.id])
  const addRoot = useAppStore((s) => s.addRoot)
  const renameGroup = useAppStore((s) => s.renameGroup)
  const deleteGroup = useAppStore((s) => s.deleteGroup)
  const confirm = useConfirm()

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")

  const startRename = () => {
    setDraft(group.name)
    setEditing(true)
  }

  const commitRename = () => {
    setEditing(false)
    void renameGroup(group.id, draft)
  }

  const onEditKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key === "Enter") {
      event.preventDefault()
      commitRename()
    } else if (event.key === "Escape") {
      event.preventDefault()
      setEditing(false)
    }
  }

  return (
    <SidebarMenuItem>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {editing ? (
            <div className="flex h-8 items-center gap-2 rounded-md bg-sidebar-accent pr-2 pl-2.5 ring-1 ring-transparent ring-inset focus-within:ring-ring/50">
              <Layers className="size-4 shrink-0 opacity-70" />
              <Input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onEditKeyDown}
                onBlur={commitRename}
                onFocus={(e) => e.target.select()}
                className="h-full min-w-0 flex-1 border-0 bg-transparent px-0 text-sm font-medium text-sidebar-foreground shadow-none focus-visible:border-0 focus-visible:ring-0"
              />
            </div>
          ) : (
            <SidebarMenuButton
              isActive={active}
              onClick={onToggle}
              className="cursor-default hover:bg-transparent hover:text-sidebar-foreground active:bg-transparent active:text-sidebar-foreground data-[active=true]:bg-transparent data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground"
            >
              <ChevronRight
                className={cn("transition-transform", expanded && "rotate-90")}
              />
              <Layers className="opacity-70" />
              {/* biome-ignore lint/a11y/noStaticElementInteractions: double-click rename is a standard file-explorer interaction; the parent row is the keyboard-accessible target */}
              <span
                className="min-w-0 flex-1 truncate font-medium"
                onDoubleClick={startRename}
              >
                {group.name}
              </span>
              {roots && roots.length > 0 ? (
                // Quiet folder count; fades out as the hover action takes the
                // row's right side, so the two don't overlap.
                <span
                  className="shrink-0 font-normal text-[11px] text-sidebar-foreground/40 tabular-nums transition-opacity group-hover/menu-item:opacity-0 group-focus-within/menu-item:opacity-0"
                  aria-label={`${roots.length} folder${roots.length === 1 ? "" : "s"}`}
                >
                  {roots.length}
                </span>
              ) : null}
            </SidebarMenuButton>
          )}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-40">
          <ContextMenuItem onSelect={() => startRename()}>
            <Pencil />
            Rename
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onSelect={async () => {
              if (
                await confirm({
                  title: "Delete group?",
                  description: `"${group.name}" and all of its sessions will be permanently deleted.`,
                  confirmLabel: "Delete",
                  destructive: true,
                })
              ) {
                void deleteGroup(group.id)
              }
            }}
          >
            <Trash2 />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {editing ? null : (
        <RowAction scope="item">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`Add folder to ${group.name}`}
                onClick={() => void addRoot(group.id)}
                className={ROW_ICON}
              >
                <FolderPlus />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Add folder</TooltipContent>
          </Tooltip>
        </RowAction>
      )}

      {expanded ? (
        <SidebarMenuSub className={SUB_CLASS}>
          {roots && roots.length > 0 ? (
            roots.map((root) => (
              <RootRow key={root.id} groupId={group.id} project={root} />
            ))
          ) : (
            <button
              type="button"
              onClick={() => void addRoot(group.id)}
              className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground/70 transition-colors hover:text-foreground"
            >
              <FolderPlus className="size-3.5" />
              Add folder
            </button>
          )}
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  )
}

const PRIMARY_NAV = [
  { id: WORKFLOWS_TAB_ID, label: "Workflows", icon: WorkflowIcon },
  { id: TASKS_TAB_ID, label: "Tasks", icon: ListTodo },
  { id: ISSUES_TAB_ID, label: "Issues", icon: CircleDot },
] as const

/** Top-level destinations, each opening a singleton tab. Collapse to icons in
 *  the rail (with tooltips) and highlight when their tab is focused. */
function PrimaryNav() {
  const activeTabId = useAppStore((s) => s.activeTabId)
  const openTab = useAppStore((s) => s.openTab)
  const workflowCount = useAppStore((s) => Object.keys(s.workflows).length)
  const activeRuns = useAppStore(
    (s) =>
      Object.values(s.workflowRunStatusById).filter(
        (st) => st === "running" || st === "paused"
      ).length
  )
  return (
    <SidebarMenu>
      {PRIMARY_NAV.map(({ id, label, icon: Icon }) => {
        const count = id === WORKFLOWS_TAB_ID ? workflowCount : 0
        const running = id === WORKFLOWS_TAB_ID ? activeRuns : 0
        return (
          <SidebarMenuItem key={id}>
            <SidebarMenuButton
              isActive={activeTabId === id}
              onClick={() => openTab(id)}
              tooltip={label}
            >
              <Icon />
              <span>{label}</span>
              {count > 0 ? (
                <span className="ml-auto flex items-center gap-1.5 group-data-[collapsible=icon]:hidden">
                  {running > 0 ? (
                    <span
                      className="relative flex size-1.5"
                      title={`${running} running`}
                    >
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500/70" />
                      <span className="relative inline-flex size-1.5 rounded-full bg-blue-500" />
                    </span>
                  ) : null}
                  <Badge
                    variant="secondary"
                    className="h-[18px] min-w-[18px] justify-center rounded-[5px] border border-border/50 px-1 font-medium font-mono text-[10px] tabular-nums"
                  >
                    {count}
                  </Badge>
                </span>
              ) : null}
            </SidebarMenuButton>
            {/* Collapsed rail: surface active runs as a corner dot. */}
            {running > 0 ? (
              <span className="pointer-events-none absolute top-1 right-1 hidden size-1.5 animate-pulse rounded-full bg-blue-500 group-data-[collapsible=icon]:block" />
            ) : null}
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}

export function Sidebar() {
  const groups = useAppStore((s) => s.groups)
  const activeGroupId = useAppStore((s) => s.activeGroupId)
  const selectGroup = useAppStore((s) => s.selectGroup)
  const createGroup = useAppStore((s) => s.createGroup)
  const openSettings = useAppStore((s) => s.openSettings)
  const loadAllWorkflows = useAppStore((s) => s.loadAllWorkflows)
  const needsSetup = useAppStore((s) =>
    s.providers.some((p) => !p.installed || !p.authed)
  )

  // Populate the global workflow set once so the count badge + Workflows page
  // reflect every project, not just the active group's.
  useEffect(() => {
    void loadAllWorkflows()
  }, [loadAllWorkflows])

  // Injected at build time (vite define) — no Tauri runtime call to fail.
  const version = __APP_VERSION__

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(activeGroupId ? [activeGroupId] : [])
  )

  // Keep the active group expanded as it changes (initial load, create) — the
  // "adjust state during render when a value changes" pattern, no effect needed.
  const [seenGroup, setSeenGroup] = useState(activeGroupId)
  if (activeGroupId && activeGroupId !== seenGroup) {
    setSeenGroup(activeGroupId)
    if (!expanded.has(activeGroupId)) {
      setExpanded((prev) => new Set(prev).add(activeGroupId))
    }
  }

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    void selectGroup(id)
  }

  return (
    <SidebarRoot variant="floating" collapsible="icon">
      <SidebarContent className="gap-0 overflow-hidden">
        {/* Primary destinations — pinned above the scrolling groups tree. */}
        <SidebarGroup className="shrink-0 p-2 pb-2">
          <PrimaryNav />
        </SidebarGroup>
        <div className="mx-2 border-sidebar-border border-t group-data-[collapsible=icon]:mx-1.5" />
        {/* Groups tree — its own scroll panel so the nav above stays put. */}
        <SidebarGroup className="flex min-h-0 flex-1 flex-col overflow-hidden p-2 pt-2">
          <div className="flex shrink-0 items-center justify-between gap-2 pb-1 pl-2 group-data-[collapsible=icon]:hidden">
            <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Groups
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void createGroup("New group")}
              title="New group"
              aria-label="New group"
            >
              <Plus />
            </Button>
          </div>
          <SidebarMenu className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
            {groups.length === 0 ? (
              <p className="px-2 py-4 text-xs text-muted-foreground">
                No groups yet — create one to start.
              </p>
            ) : (
              groups.map((group) => (
                <GroupRow
                  key={group.id}
                  group={group}
                  active={group.id === activeGroupId}
                  expanded={expanded.has(group.id)}
                  onToggle={() => toggle(group.id)}
                />
              ))
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-2 pt-0">
        <UpdateBanner />
        <button
          type="button"
          onClick={() => openSettings()}
          aria-label="Settings"
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <Settings2 className="size-4 shrink-0" />
          <span className="truncate">Settings</span>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {needsSetup && (
              <span
                className="size-1.5 rounded-full bg-amber-500"
                title="A provider needs setup"
              />
            )}
            {version ? (
              <span className="text-[11px] tabular-nums text-muted-foreground/45">
                v{version}
              </span>
            ) : null}
          </span>
        </button>
      </SidebarFooter>
    </SidebarRoot>
  )
}
