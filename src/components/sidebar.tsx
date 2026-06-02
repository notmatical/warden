import {
  useEffect,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react"
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

// Keep shadcn's left connector line; tighten the rhythm and drop the right
// padding (pl only) to reclaim width for long names.
const SUB_CLASS = "gap-0.5 pr-0"

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
              className="w-full cursor-default text-left text-sidebar-foreground/70 hover:bg-transparent hover:text-sidebar-foreground active:bg-transparent data-[active=true]:bg-transparent data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground"
            >
              <button
                type="button"
                onClick={() => openSession(sessionId)}
                onDoubleClick={startRename}
                title={session.title}
              >
                <StatusDot status={session.status} />
                <span className="min-w-0 flex-1 truncate">{session.title}</span>
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
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <SidebarMenuSubButton
            asChild
            className="w-full cursor-default text-left text-sidebar-foreground/70 hover:bg-transparent hover:text-sidebar-foreground active:bg-transparent active:text-sidebar-foreground"
          >
            <button type="button" onClick={onToggle} title={project.path}>
              <ChevronRight
                className={cn("transition-transform", expanded && "rotate-90")}
              />
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
            <Sparkles />
            Agent session
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void newSession("terminal")}>
            <SquareTerminal />
            Terminal session
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
              className="cursor-default hover:bg-transparent hover:text-sidebar-foreground data-[active=true]:bg-transparent data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground"
            >
              <ChevronRight
                className={cn("transition-transform", expanded && "rotate-90")}
              />
              <Layers className="opacity-70" />
              <span
                className="min-w-0 flex-1 truncate font-medium"
                onDoubleClick={startRename}
              >
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
