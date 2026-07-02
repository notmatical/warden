import { ChevronDown, ChevronRight, Plus } from "lucide-react"
import { type ReactNode, useMemo, useState } from "react"
import { toast } from "sonner"

import {
  DataTable,
  DataTableEmpty,
  DataTableRow,
} from "@/components/common/data-table"
import {
  FILTER_SURFACE,
  FilterMenu,
  type FilterOption,
  SwatchStack,
} from "@/components/common/filter-menu"
import { Input } from "@/components/ui/input"
import { formatExact, relativeTime } from "@/lib/time"
import { cn } from "@/lib/utils"

import type { LinearIssue, LinearState } from "../types"
import { PriorityIcon, StatusIcon } from "./issue-icons"

// Group order follows Linear: in-progress first, then todo, backlog, done, canceled.
const TYPE_ORDER: Record<string, number> = {
  started: 0,
  unstarted: 1,
  backlog: 2,
  completed: 3,
  canceled: 4,
}

// Urgent (1) sorts first; "no priority" (0) sorts last.
const priorityRank = (p: number) => (p === 0 ? 99 : p)

const PRIORITY_FILTER = [
  { value: "1", label: "Urgent" },
  { value: "2", label: "High" },
  { value: "3", label: "Medium" },
  { value: "4", label: "Low" },
  { value: "0", label: "No priority" },
]

interface Group {
  state: LinearState
  issues: LinearIssue[]
}

function toggleIn(set: Set<string>, value: string, on: boolean): Set<string> {
  const next = new Set(set)
  if (on) next.add(value)
  else next.delete(value)
  return next
}

/** Filterable Linear issue list grouped by workflow state: a borderless filter
 *  row over a card table (the FolderView treatment). Reused by the global
 *  Tasks destination and folder dashboards. */
export function IssueList({
  issues,
  onSelect,
  syncing = false,
  error = null,
  emptyMessage = "No issues assigned to you.",
  scroll = true,
  className,
  leading,
  trailing,
}: {
  issues: LinearIssue[]
  onSelect: (issue: LinearIssue) => void
  syncing?: boolean
  error?: string | null
  emptyMessage?: string
  /** Scroll the table internally (full-height views); off for stacked pages. */
  scroll?: boolean
  className?: string
  /** Header-row content left of the filters (title, count chip…). */
  leading?: ReactNode
  /** Header-row content after the filters (refresh, menus…). */
  trailing?: ReactNode
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const [search, setSearch] = useState("")
  const [statusSel, setStatusSel] = useState<Set<string>>(new Set())
  const [prioritySel, setPrioritySel] = useState<Set<string>>(new Set())
  const [labelSel, setLabelSel] = useState<Set<string>>(new Set())

  // ----- filter options derived from the cached data ----------------------

  const statusOptions = useMemo<FilterOption[]>(() => {
    const seen = new Map<string, LinearState>()
    for (const i of issues)
      if (!seen.has(i.state.name)) seen.set(i.state.name, i.state)
    return [...seen.values()]
      .sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9))
      .map((s) => ({
        value: s.name,
        label: s.name,
        swatch: <StatusIcon type={s.type} color={s.color} className="size-3" />,
      }))
  }, [issues])

  const priorityOptions = useMemo<FilterOption[]>(
    () =>
      PRIORITY_FILTER.map((p) => ({
        value: p.value,
        label: p.label,
        swatch: <PriorityIcon priority={Number(p.value)} />,
      })),
    []
  )

  const labelOptions = useMemo<FilterOption[]>(() => {
    const seen = new Set<string>()
    for (const i of issues) for (const l of i.labels) seen.add(l)
    return [...seen].sort().map((l) => ({ value: l, label: l }))
  }, [issues])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return issues.filter((i) => {
      if (
        q &&
        !i.title.toLowerCase().includes(q) &&
        !i.identifier.toLowerCase().includes(q)
      )
        return false
      if (statusSel.size > 0 && !statusSel.has(i.state.name)) return false
      if (prioritySel.size > 0 && !prioritySel.has(String(i.priority)))
        return false
      if (labelSel.size > 0 && !i.labels.some((l) => labelSel.has(l)))
        return false
      return true
    })
  }, [issues, search, statusSel, prioritySel, labelSel])

  const groups = useMemo<Group[]>(() => {
    const byName = new Map<string, Group>()
    for (const issue of filtered) {
      const existing = byName.get(issue.state.name)
      if (existing) existing.issues.push(issue)
      else byName.set(issue.state.name, { state: issue.state, issues: [issue] })
    }
    const arr = [...byName.values()]
    for (const g of arr) {
      g.issues.sort(
        (a, b) =>
          priorityRank(a.priority) - priorityRank(b.priority) ||
          b.updatedAt.localeCompare(a.updatedAt)
      )
    }
    arr.sort(
      (a, b) =>
        (TYPE_ORDER[a.state.type] ?? 9) - (TYPE_ORDER[b.state.type] ?? 9) ||
        a.state.name.localeCompare(b.state.name)
    )
    return arr
  }, [filtered])

  const toggleGroup = (name: string) =>
    setCollapsed((prev) => toggleIn(prev, name, !prev.has(name)))

  const table = (
    <DataTable>
      {filtered.length === 0 ? (
        <DataTableEmpty>
          {issues.length === 0
            ? error && !syncing
              ? error
              : syncing
                ? "Syncing…"
                : emptyMessage
            : "No issues match your filters."}
        </DataTableEmpty>
      ) : (
        groups.map((group) => {
          const isCollapsed = collapsed.has(group.state.name)
          return (
            <div key={group.state.name}>
              <div
                className="group/section flex items-center gap-2.5 border-foreground/5 border-b px-4 py-2"
                style={{
                  backgroundImage: `linear-gradient(${tint(group.state.color, 0.14)}, ${tint(group.state.color, 0.14)})`,
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleGroup(group.state.name)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  {isCollapsed ? (
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" />
                  ) : (
                    <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/70" />
                  )}
                  <StatusIcon
                    type={group.state.type}
                    color={group.state.color}
                    className="size-3.5"
                  />
                  <span className="truncate font-medium text-[13px] text-foreground">
                    {group.state.name}
                  </span>
                  <span className="font-medium text-[11px] text-muted-foreground tabular-nums">
                    {group.issues.length}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`New issue in ${group.state.name}`}
                  onClick={() =>
                    toast("Creating issues lands with writeback support.")
                  }
                  className="shrink-0 rounded p-1 text-muted-foreground/70 opacity-0 transition hover:bg-foreground/10 hover:text-foreground group-hover/section:opacity-100"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
              {!isCollapsed
                ? group.issues.map((issue) => (
                    <IssueRow
                      key={issue.id}
                      issue={issue}
                      onClick={() => onSelect(issue)}
                    />
                  ))
                : null}
            </div>
          )
        })
      )}
    </DataTable>
  )

  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        scroll && "min-h-0 flex-1",
        className
      )}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {leading}
        <div className="flex-1" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search issues…"
          className={cn("h-8 w-48", FILTER_SURFACE)}
        />
        <FilterMenu
          label="Status"
          icon={<SwatchStack swatches={statusOptions.map((o) => o.swatch)} />}
          options={statusOptions}
          selected={statusSel}
          onToggle={(v, on) => setStatusSel((p) => toggleIn(p, v, on))}
          onClear={() => setStatusSel(new Set())}
        />
        <FilterMenu
          label="Priority"
          options={priorityOptions}
          selected={prioritySel}
          onToggle={(v, on) => setPrioritySel((p) => toggleIn(p, v, on))}
          onClear={() => setPrioritySel(new Set())}
        />
        <FilterMenu
          label="Label"
          options={labelOptions}
          selected={labelSel}
          onToggle={(v, on) => setLabelSel((p) => toggleIn(p, v, on))}
          onClear={() => setLabelSel(new Set())}
        />
        {trailing}
      </div>

      {scroll ? (
        <div className="min-h-0 flex-1 overflow-y-auto">{table}</div>
      ) : (
        table
      )}
    </div>
  )
}

function IssueRow({
  issue,
  onClick,
}: {
  issue: LinearIssue
  onClick: () => void
}) {
  return (
    <DataTableRow
      onClick={onClick}
      className="flex w-full items-center gap-3 text-left"
    >
      <PriorityIcon
        priority={issue.priority}
        className="size-4 text-muted-foreground"
      />
      <span className="w-14 shrink-0 truncate font-mono text-muted-foreground/80 text-xs tabular-nums">
        {issue.identifier}
      </span>
      <StatusIcon
        type={issue.state.type}
        color={issue.state.color}
        className="size-4"
      />
      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
        {issue.title}
      </span>
      {issue.labels.length > 0 ? (
        <div className="hidden shrink-0 items-center gap-1 sm:flex">
          {issue.labels.slice(0, 2).map((label) => (
            <span
              key={label}
              className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {label}
            </span>
          ))}
        </div>
      ) : null}
      {issue.assignee ? (
        <Avatar user={issue.assignee} />
      ) : (
        <span className="size-5 shrink-0" />
      )}
      <span
        title={formatExact(issue.updatedAt)}
        className="w-16 shrink-0 text-right text-muted-foreground text-xs tabular-nums"
      >
        {relativeTime(issue.updatedAt)}
      </span>
    </DataTableRow>
  )
}

export function Avatar({
  user,
}: {
  user: { name: string; avatarUrl: string | null }
}) {
  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt=""
        className="size-5 shrink-0 rounded-full"
      />
    )
  }
  const initial = user.name.trim().charAt(0).toUpperCase() || "?"
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground">
      {initial}
    </span>
  )
}

/** A translucent rgba derived from a Linear "#rrggbb" state color, for tinting. */
function tint(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return `rgba(127, 127, 127, ${alpha})`
  const n = Number.parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
