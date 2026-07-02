import { CircleDot, FolderGit2 } from "lucide-react"
import { useMemo, useState } from "react"

import {
  DataTable,
  DataTableEmpty,
  DataTableRow,
} from "@/components/common/data-table"
import {
  FILTER_SURFACE,
  FilterMenu,
  type FilterOption,
} from "@/components/common/filter-menu"
import { Input } from "@/components/ui/input"
import { formatExact, relativeTime } from "@/lib/time"
import { cn } from "@/lib/utils"

import type { RepoIssue } from "../types"

function toggleIn(set: Set<string>, value: string, on: boolean): Set<string> {
  const next = new Set(set)
  if (on) next.add(value)
  else next.delete(value)
  return next
}

/** Assigned GitHub issues grouped by repo: a borderless filter row over a
 *  card table, matching the Linear issue list's treatment. */
export function GithubIssueList({
  issues,
  onSelect,
  loading = false,
  emptyMessage = "No open issues assigned to you.",
  leading,
  trailing,
}: {
  issues: RepoIssue[]
  onSelect: (issue: RepoIssue) => void
  loading?: boolean
  emptyMessage?: string
  leading?: React.ReactNode
  trailing?: React.ReactNode
}) {
  const [search, setSearch] = useState("")
  const [repoSel, setRepoSel] = useState<Set<string>>(new Set())
  const [labelSel, setLabelSel] = useState<Set<string>>(new Set())

  const repoOptions = useMemo<FilterOption[]>(() => {
    const seen = new Map<string, string>()
    for (const i of issues) seen.set(i.projectId, i.projectName)
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [issues])

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
        !`#${i.number}`.includes(q)
      )
        return false
      if (repoSel.size > 0 && !repoSel.has(i.projectId)) return false
      if (labelSel.size > 0 && !i.labels.some((l) => labelSel.has(l)))
        return false
      return true
    })
  }, [issues, search, repoSel, labelSel])

  const groups = useMemo(() => {
    const byRepo = new Map<string, { name: string; issues: RepoIssue[] }>()
    for (const issue of filtered) {
      const existing = byRepo.get(issue.projectId)
      if (existing) existing.issues.push(issue)
      else
        byRepo.set(issue.projectId, {
          name: issue.projectName,
          issues: [issue],
        })
    }
    const arr = [...byRepo.entries()]
    for (const [, g] of arr)
      g.issues.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    arr.sort((a, b) => a[1].name.localeCompare(b[1].name))
    return arr
  }, [filtered])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
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
          label="Repo"
          options={repoOptions}
          selected={repoSel}
          onToggle={(v, on) => setRepoSel((p) => toggleIn(p, v, on))}
          onClear={() => setRepoSel(new Set())}
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        <DataTable>
          {filtered.length === 0 ? (
            <DataTableEmpty>
              {issues.length === 0
                ? loading
                  ? "Loading issues…"
                  : emptyMessage
                : "No issues match your filters."}
            </DataTableEmpty>
          ) : (
            groups.map(([projectId, group]) => (
              <div key={projectId}>
                <div className="flex items-center gap-2.5 border-foreground/5 border-b bg-foreground/[0.02] px-4 py-2">
                  <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium text-[13px] text-foreground">
                    {group.name}
                  </span>
                  <span className="font-medium text-[11px] text-muted-foreground tabular-nums">
                    {group.issues.length}
                  </span>
                </div>
                {group.issues.map((issue) => (
                  <DataTableRow
                    key={issue.url}
                    onClick={() => onSelect(issue)}
                    className="flex w-full items-center gap-3 text-left"
                  >
                    <CircleDot className="size-4 shrink-0 text-emerald-500" />
                    <span className="w-12 shrink-0 truncate font-mono text-muted-foreground/80 text-xs tabular-nums">
                      #{issue.number}
                    </span>
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
                    <span
                      title={formatExact(issue.updatedAt)}
                      className="w-16 shrink-0 text-right text-muted-foreground text-xs tabular-nums"
                    >
                      {relativeTime(issue.updatedAt)}
                    </span>
                  </DataTableRow>
                ))}
              </div>
            ))
          )}
        </DataTable>
      </div>
    </div>
  )
}
