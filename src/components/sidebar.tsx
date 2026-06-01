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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { DEFAULT_CHAT_MODEL } from "@/lib/models"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"
import type { Group, Project, SessionKind } from "@/types"

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
        <div
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors",
            active
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          )}
        >
          <StatusDot status={session.status} />
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onEditKeyDown}
              onBlur={commitRename}
              onFocus={(e) => e.target.select()}
              className="min-w-0 flex-1 rounded-sm bg-background px-1 text-sm outline-none ring-1 ring-border"
            />
          ) : (
            <button
              type="button"
              onClick={() => openSession(sessionId)}
              onDoubleClick={startRename}
              className="min-w-0 flex-1 truncate text-left"
              title={session.title}
            >
              {session.title}
            </button>
          )}
        </div>
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
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="group/row relative flex items-center rounded-md hover:bg-muted/50">
            <button
              type="button"
              onClick={onToggle}
              className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-7 pl-2 text-left text-sm text-muted-foreground transition-colors"
            >
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 transition-transform",
                  expanded && "rotate-90"
                )}
              />
              <FolderGit2 className="size-3.5 shrink-0 opacity-70" />
              <span className="truncate" title={project.path}>
                {project.name}
              </span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`New session in ${project.name}`}
                  title="New session"
                  className="absolute right-1 flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground group-hover/row:opacity-100 data-[state=open]:opacity-100"
                >
                  <Plus className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
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

      {expanded && (
        <div className="mt-0.5 ml-3 flex flex-col gap-0.5 border-l border-border/50 pl-2">
          {rootSessions.length > 0 ? (
            rootSessions.map((id) => <SessionRow key={id} sessionId={id} />)
          ) : (
            <p className="px-2 py-1 text-xs text-muted-foreground/60">
              No sessions yet
            </p>
          )}
        </div>
      )}
    </div>
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
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "group/row relative flex items-center rounded-md",
              active ? "bg-muted/40" : "hover:bg-muted/50"
            )}
          >
            <button
              type="button"
              onClick={onToggle}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-7 pl-2 text-left text-sm transition-colors",
                active ? "text-foreground" : "text-muted-foreground"
              )}
            >
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 transition-transform",
                  expanded && "rotate-90"
                )}
              />
              <Layers className="size-3.5 shrink-0 opacity-70" />
              {editing ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onEditKeyDown}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  onFocus={(e) => e.target.select()}
                  className="min-w-0 flex-1 rounded-sm bg-background px-1 text-sm outline-none ring-1 ring-border"
                />
              ) : (
                <span
                  className="truncate font-medium"
                  onDoubleClick={startRename}
                  title={group.name}
                >
                  {group.name}
                </span>
              )}
            </button>
            <button
              type="button"
              aria-label={`Add folder to ${group.name}`}
              title="Add folder"
              onClick={(e) => {
                e.stopPropagation()
                void addRoot(group.id)
              }}
              className="absolute right-1 flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground group-hover/row:opacity-100"
            >
              <FolderPlus className="size-3.5" />
            </button>
          </div>
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

      {expanded && (
        <div className="mt-0.5 ml-3 flex flex-col gap-0.5 border-l border-border/50 pl-2">
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
        </div>
      )}
    </div>
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
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border/60 bg-sidebar">
      <div className="flex h-14 shrink-0 items-center justify-between px-3">
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

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 px-2 pb-3">
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
        </div>
      </ScrollArea>
    </aside>
  )
}
