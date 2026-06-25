import { useState } from "react"

import { SegmentedTabs } from "@/components/ui/segmented-tabs"
import { GithubIssuesView } from "@/integrations/github/components/github-issues-view"
import { LinearTasksView } from "@/integrations/linear/components/linear-tasks-view"

type IssueSource = "linear" | "github"

const SOURCE_KEY = "warden.issues.source"

const SOURCE_TABS = [
  { id: "linear", label: "Linear" },
  { id: "github", label: "GitHub" },
] as const

function readStoredSource(): IssueSource {
  const stored = localStorage.getItem(SOURCE_KEY)
  return stored === "github" || stored === "linear" ? stored : "linear"
}

/** The unified Issues destination. Linear and GitHub are the same primitive —
 *  a tracked task to hand to an agent — so they share one destination with a
 *  source switch instead of two near-identical top-level tabs. */
export function IssuesView() {
  const [source, setSource] = useState<IssueSource>(readStoredSource)

  const changeSource = (next: IssueSource) => {
    setSource(next)
    localStorage.setItem(SOURCE_KEY, next)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pt-5 pb-3">
        <SegmentedTabs
          tabs={SOURCE_TABS}
          value={source}
          onChange={changeSource}
        />
      </div>
      <div className="min-h-0 flex-1">
        {source === "linear" ? <LinearTasksView /> : <GithubIssuesView />}
      </div>
    </div>
  )
}
