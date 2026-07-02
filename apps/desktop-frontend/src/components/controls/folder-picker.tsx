import { Check, ChevronDown, ChevronRight, FolderGit2 } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"
import type { Project } from "@/types"

/** A folder selection: the root plus the group it was picked under — the same
 *  root can live in several groups, and sessions belong to exactly one. */
export interface FolderRef {
  groupId: string
  projectId: string
}

interface GroupEntry {
  id: string
  name: string
  roots: Project[]
}

/** Searchable, group-structured folder picker. Groups collapse like the
 *  sidebar; searching flattens across all of them. */
export function FolderPicker({
  value,
  onChange,
}: {
  value: FolderRef | null
  onChange: (ref: FolderRef) => void
}) {
  const groups = useAppStore((s) => s.groups)
  const rootsByGroup = useAppStore((s) => s.rootsByGroup)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const entries = useMemo<GroupEntry[]>(
    () =>
      groups
        .map((g) => ({
          id: g.id,
          name: g.name,
          roots: rootsByGroup[g.id] ?? [],
        }))
        .filter((g) => g.roots.length > 0),
    [groups, rootsByGroup]
  )

  const q = query.trim().toLowerCase()
  const visible = useMemo<GroupEntry[]>(() => {
    if (!q) return entries
    return entries
      .map((g) => ({
        ...g,
        roots: g.roots.filter(
          (p) =>
            p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.roots.length > 0)
  }, [entries, q])

  const selected = useMemo(() => {
    if (!value) return null
    const group = entries.find((g) => g.id === value.groupId)
    const root = group?.roots.find((p) => p.id === value.projectId)
    return group && root ? { group, root } : null
  }, [entries, value])

  const toggleGroup = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const pick = (groupId: string, projectId: string) => {
    onChange({ groupId, projectId })
    setOpen(false)
    setQuery("")
  }

  return (
    // Modal so the list owns wheel events inside dialogs (matches ModelMenu).
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-9 w-full justify-between gap-2 border-input bg-transparent px-3 font-normal hover:bg-input/30 dark:bg-input/30 dark:hover:bg-input/50"
        >
          {selected ? (
            <span className="flex min-w-0 items-center gap-2">
              <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm">{selected.root.name}</span>
              <span className="truncate text-muted-foreground text-xs">
                {selected.group.name}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground text-sm">Pick a folder</span>
          )}
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <div className="border-b p-1.5">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search folders…"
            className="h-7 border-none bg-transparent text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {visible.length === 0 ? (
            <div className="px-2 py-4 text-center text-muted-foreground text-xs">
              No folders match.
            </div>
          ) : (
            visible.map((group) => {
              const isCollapsed = !q && collapsed.has(group.id)
              return (
                <div key={group.id}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left font-medium text-[11px] text-muted-foreground uppercase tracking-wide hover:bg-accent/50"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="size-3 shrink-0" />
                    ) : (
                      <ChevronDown className="size-3 shrink-0" />
                    )}
                    <span className="truncate">{group.name}</span>
                    <span className="font-normal tabular-nums">
                      {group.roots.length}
                    </span>
                  </button>
                  {!isCollapsed
                    ? group.roots.map((root) => {
                        const isSelected =
                          value?.groupId === group.id &&
                          value.projectId === root.id
                        return (
                          <button
                            key={root.id}
                            type="button"
                            onClick={() => pick(group.id, root.id)}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md py-1.5 pr-2 pl-6 text-left hover:bg-accent",
                              isSelected && "bg-accent/60"
                            )}
                          >
                            <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm">
                                {root.name}
                              </span>
                              <span className="block truncate font-mono text-[10px] text-muted-foreground/70">
                                {root.path}
                              </span>
                            </span>
                            <Check
                              className={cn(
                                "size-3.5 shrink-0",
                                isSelected ? "opacity-100" : "opacity-0"
                              )}
                            />
                          </button>
                        )
                      })
                    : null}
                </div>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
