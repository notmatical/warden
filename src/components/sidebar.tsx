import { useState, type KeyboardEvent } from "react"
import {
  ChevronRight,
  FolderGit2,
  FolderPlus,
  Pencil,
  Plus,
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
import { ScrollArea } from "@/components/ui/scroll-area"
import { DEFAULT_CHAT_MODEL } from "@/lib/models"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"
import type { Project } from "@/types"

function SessionRow({ sessionId }: { sessionId: string }) {
  const session = useAppStore((s) => s.sessions[sessionId])
  const active = useAppStore((s) => s.activeSessionId === sessionId)
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

function ProjectRow({
  project,
  expanded,
  active,
  onToggle,
}: {
  project: Project
  expanded: boolean
  active: boolean
  onToggle: () => void
}) {
  const sessionIds = useAppStore((s) => s.sessionsByProject[project.id])
  const selectProject = useAppStore((s) => s.selectProject)
  const createSession = useAppStore((s) => s.createSession)

  const newSession = async () => {
    await selectProject(project.id)
    await createSession({
      title: "New session",
      model: DEFAULT_CHAT_MODEL,
      permissionMode: "bypassPermissions",
      role: "chat",
    })
  }

  return (
    <div>
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
          <FolderGit2 className="size-3.5 shrink-0 opacity-70" />
          <span className="truncate font-medium" title={project.path}>
            {project.name}
          </span>
        </button>
        <button
          type="button"
          onClick={() => void newSession()}
          aria-label={`New session in ${project.name}`}
          title="New session"
          className="absolute right-1 flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground group-hover/row:opacity-100"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      {expanded && (
        <div className="mt-0.5 ml-3 flex flex-col gap-0.5 border-l border-border/50 pl-2">
          {sessionIds && sessionIds.length > 0 ? (
            sessionIds.map((id) => <SessionRow key={id} sessionId={id} />)
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

export function Sidebar() {
  const projects = useAppStore((s) => s.projects)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const selectProject = useAppStore((s) => s.selectProject)
  const openProject = useAppStore((s) => s.openProject)

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(activeProjectId ? [activeProjectId] : [])
  )

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    void selectProject(id)
  }

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border/60 bg-sidebar">
      <div className="flex h-14 shrink-0 items-center justify-between px-3">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Projects
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void openProject()}
          title="Open a project folder"
          aria-label="Open a project folder"
        >
          <FolderPlus />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 px-2 pb-3">
          {projects.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              No projects yet — open a folder to start.
            </p>
          ) : (
            projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                expanded={expanded.has(project.id)}
                active={project.id === activeProjectId}
                onToggle={() => toggle(project.id)}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </aside>
  )
}
