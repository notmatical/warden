import { CircleDot, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { CountChip } from "@/components/common/count-chip"
import { FILTER_SURFACE } from "@/components/common/filter-menu"
import { DestinationEmpty } from "@/components/destination-empty"
import { GitHubIcon } from "@/components/icons/brand"
import { Button } from "@/components/ui/button"
import { GithubIssueList } from "@/integrations/github/components/github-issue-list"
import { GithubIssuePeek } from "@/integrations/github/components/github-issue-peek"
import { SendGithubIssueDialog } from "@/integrations/github/components/send-github-issue-dialog"
import { listMyIssues } from "@/integrations/github/ipc"
import type { GhIssueComment, RepoIssue } from "@/integrations/github/types"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"

/** Issues destination: open GitHub issues assigned to you, aggregated across
 *  every git root (per-repo soft-fail), grouped by repo. */
export function IssuesView() {
  const rootsByGroup = useAppStore((s) => s.rootsByGroup)
  const githubStatus = useAppStore((s) => s.githubStatus)
  const loadGithubStatus = useAppStore((s) => s.loadGithubStatus)
  const openSettings = useAppStore((s) => s.openSettings)

  // The same folder can be a root in several groups — dedupe by path.
  const roots = useMemo(() => {
    const byPath = new Map<string, { id: string; name: string }>()
    for (const root of Object.values(rootsByGroup).flat())
      if (root.isGit && !byPath.has(root.path))
        byPath.set(root.path, { id: root.id, name: root.name })
    return [...byPath.values()]
  }, [rootsByGroup])

  const [issues, setIssues] = useState<RepoIssue[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const results = await Promise.allSettled(
        roots.map(async (root) => {
          const list = await listMyIssues(root.id)
          return list.map((issue) => ({
            ...issue,
            projectId: root.id,
            projectName: root.name,
          }))
        })
      )
      const seen = new Set<string>()
      const all: RepoIssue[] = []
      for (const result of results) {
        if (result.status !== "fulfilled") continue
        for (const issue of result.value) {
          if (seen.has(issue.url)) continue
          seen.add(issue.url)
          all.push(issue)
        }
      }
      setIssues(all)
    } finally {
      setLoading(false)
    }
  }, [roots])

  useEffect(() => {
    void loadGithubStatus()
  }, [loadGithubStatus])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const [peeked, setPeeked] = useState<RepoIssue | null>(null)
  const [send, setSend] = useState<{
    issue: RepoIssue
    comments: GhIssueComment[]
  } | null>(null)

  if (roots.length === 0) {
    return (
      <DestinationEmpty
        icon={CircleDot}
        title="Issues"
        description="Add a git folder to a group to see its GitHub issues here."
      />
    )
  }

  if (githubStatus && (!githubStatus.installed || !githubStatus.authed)) {
    return (
      <DestinationEmpty
        icon={CircleDot}
        title="Issues"
        description="Sign in to the GitHub CLI to browse the issues assigned to you."
        action={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => openSettings("integrations")}
          >
            <GitHubIcon />
            Set up GitHub
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <GithubIssueList
        issues={issues}
        loading={loading}
        onSelect={setPeeked}
        leading={
          <span className="flex items-center gap-2.5">
            <CircleDot className="size-4 shrink-0 text-muted-foreground" />
            <h1 className="font-semibold text-foreground">Issues</h1>
            <CountChip>{issues.length}</CountChip>
          </span>
        }
        trailing={
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Refresh"
            onClick={() => void refresh()}
            disabled={loading}
            className={cn(
              "size-8 text-muted-foreground hover:bg-input/70 hover:text-foreground dark:hover:bg-input/70",
              FILTER_SURFACE
            )}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
        }
      />

      <GithubIssuePeek
        open={peeked !== null}
        issue={peeked}
        onOpenChange={(open) => {
          if (!open) setPeeked(null)
        }}
        onSendToAgent={(issue, comments) => setSend({ issue, comments })}
      />

      <SendGithubIssueDialog
        issue={send?.issue ?? null}
        comments={send?.comments ?? []}
        open={send !== null}
        onOpenChange={(open) => {
          if (!open) setSend(null)
        }}
        onSent={() => setPeeked(null)}
      />
    </div>
  )
}
