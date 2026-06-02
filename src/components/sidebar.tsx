import { useEffect, useState, type KeyboardEvent } from "react"
import {
  ChevronRight,
  FolderGit2,
  FolderPlus,
  Layers,
  Pencil,
  Plus,
  Sparkles,
  SquareTerminal,
  Trash2,
} from "lucide-react"

import { StatusDot } from "@/components/status-dot"
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { DEFAULT_CHAT_MODEL } from "@/lib/models"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"
import type { Group, Project, SessionKind } from "@/types"

// Keep shadcn's left connector line; just tighten the vertical rhythm.
const SUB_CLASS = "gap-0.5"

function SessionRow({ sessionId }: { sessionId: string }) {
  const session = useAppStore((s) => s.sessions[sessionId])
  const active = useAppStore(
    (s) =>
      !!s.activeGroupId && s.activeSessionByGroup[s.activeGroupId] === sessionId
  )
  const openSession = useAppStore((s) => s.openSession)
  const renameSession = useAppStore((s) => s.renameSession)
  const deleteSession = useAppStore((s) => s.deleteSession)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")

  if (!session) return null

  const startRename = () => {
    setDraft(session.title)
    setEditing(true)
  }

  const commitRename = () => {
    setEditing(false)
    void renameSession(sessionId, draft)
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
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <SidebarMenuSubItem>
          {editing ? (
            <div className="flex h-7 items-center gap-2 px-1.5">
              <StatusDot status={session.status} />
              <Input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onEditKeyDown}
                onBlur={commitRename}
                onFocus={(e) => e.target.select()}
                className="h-5 min-w-0 flex-1 px-1 py-0 text-xs"
              />
            </div>
          ) : (
            <SidebarMenuSubButton
              asChild
              isActive={active}
              className="cursor-default text-sidebar-foreground/70 hover:bg-transparent hover:text-sidebar-foreground data-[active=true]:bg-transparent data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground"
            >
              <button
                type="button"
                onClick={() => openSession(sessionId)}
                onDoubleClick={startRename}
                title={session.title}
              >
                <StatusDot status={session.status} />
                <span>{session.title}</span>
              </button>
            </SidebarMenuSubButton>
          )}
        </SidebarMenuSubItem>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40">
        <ContextMenuItem onSelect={() => startRename()}>
          <Pencil />
          Rename
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onSelect={() => void deleteSession(sessionId)}
        >
          <Trash2 />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function RootRow({
  groupId,
  project,
  expanded,
  onToggle,
}: {
  groupId: string
  project: Project
  expanded: boolean
  onToggle: () => void
}) {
  const sessionIds = useAppStore((s) => s.sessionsByGroup[groupId])
  const sessions = useAppStore((s) => s.sessions)
  const createSession = useAppStore((s) => s.createSession)
  const removeRoot = useAppStore((s) => s.removeRoot)

  const rootSessions = (sessionIds ?? []).filter(
    (id) => sessions[id]?.projectId === project.id
  )

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
      {/* Row-height wrapper so the absolute "+" stays on the name row even when
          the root is expanded (the expanded list lives outside it). */}
      <div className="relative">
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <SidebarMenuSubButton
              asChild
              className="cursor-default pr-7 text-sidebar-foreground/70 hover:bg-transparent hover:text-sidebar-foreground"
            >
              <button type="button" onClick={onToggle} title={project.path}>
                <ChevronRight
                  className={cn("transition-transform", expanded && "rotate-90")}
                />
                <FolderGit2 className="opacity-70" />
                <span>{project.name}</span>
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
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`New session in ${project.name}`}
                  className="absolute top-1/2 right-1 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-sidebar-foreground/60 opacity-0 transition group-focus-within/menu-sub-item:opacity-100 group-hover/menu-sub-item:opacity-100 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=open]:opacity-100 [&>svg]:size-4"
                >
                  <Plus />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">New session</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="w-40">
            <DropdownMenuItem onSelect={() => void newSession("agent")}>
              <Sparkles />
              Agent session
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void newSession("terminal")}>
              <SquareTerminal />
              Terminal session
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {expanded ? (
        <SidebarMenuSub className={SUB_CLASS}>
          {rootSessions.length > 0 ? (
            rootSessions.map((id) => <SessionRow key={id} sessionId={id} />)
          ) : (
            <p className="px-2 py-1 text-xs text-muted-foreground/60">
              No sessions yet
            </p>
          )}
        </SidebarMenuSub>
      ) : null}
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

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(new Set())

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

  const toggleRoot = (id: string) => {
    setExpandedRoots((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <SidebarMenuItem>
      {/* Row-height wrapper so the absolute add-folder action stays on the name
          row even when the group is expanded. */}
      <div className="relative">
        <ContextMenu>
          <ContextMenuTrigger asChild>
            {editing ? (
              <div className="flex h-7 items-center gap-2 px-2">
                <Layers className="size-4 shrink-0 opacity-70" />
                <Input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onEditKeyDown}
                  onBlur={commitRename}
                  onFocus={(e) => e.target.select()}
                  className="h-5 min-w-0 flex-1 px-1 py-0 text-sm"
                />
              </div>
            ) : (
              <SidebarMenuButton
                isActive={active}
                onClick={onToggle}
                className="cursor-default pr-7 hover:bg-transparent hover:text-sidebar-foreground data-[active=true]:bg-transparent data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground"
              >
                <ChevronRight
                  className={cn("transition-transform", expanded && "rotate-90")}
                />
                <Layers className="opacity-70" />
                <span className="font-medium" onDoubleClick={startRename}>
                  {group.name}
                </span>
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
              onSelect={() => void deleteGroup(group.id)}
            >
              <Trash2 />
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {editing ? null : (
          <SidebarMenuAction
            showOnHover
            aria-label={`Add folder to ${group.name}`}
            title="Add folder"
            onClick={() => void addRoot(group.id)}
            className="text-muted-foreground"
          >
            <FolderPlus />
          </SidebarMenuAction>
        )}
      </div>

      {expanded ? (
        <SidebarMenuSub className={SUB_CLASS}>
          {roots && roots.length > 0 ? (
            roots.map((root) => (
              <RootRow
                key={root.id}
                groupId={group.id}
                project={root}
                expanded={expandedRoots.has(root.id)}
                onToggle={() => toggleRoot(root.id)}
              />
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

export function Sidebar() {
  const groups = useAppStore((s) => s.groups)
  const activeGroupId = useAppStore((s) => s.activeGroupId)
  const selectGroup = useAppStore((s) => s.selectGroup)
  const createGroup = useAppStore((s) => s.createGroup)

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(activeGroupId ? [activeGroupId] : [])
  )

  // Keep the active group expanded as it changes (initial load, create).
  useEffect(() => {
    if (activeGroupId) {
      setExpanded((prev) =>
        prev.has(activeGroupId) ? prev : new Set(prev).add(activeGroupId)
      )
    }
  }, [activeGroupId])

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
    <SidebarRoot variant="floating" collapsible="offcanvas">
      <SidebarHeader className="p-2">
        <div className="flex items-center justify-between gap-2 pl-2">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
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
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="p-2 pt-0">
          <SidebarMenu>
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
    </SidebarRoot>
  )
}
