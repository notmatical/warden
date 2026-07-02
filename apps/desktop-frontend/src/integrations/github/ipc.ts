import { invoke } from "@tauri-apps/api/core"

import type { GhIssue, GhIssueComment } from "./types"

/** Open issues assigned to me in one repo (empty when gh can't list there). */
export function listMyIssues(projectId: string): Promise<GhIssue[]> {
  return invoke("list_my_issues", { projectId })
}

/** Comments on one issue, fetched lazily for the detail view. */
export function githubIssueComments(
  projectId: string,
  number: number
): Promise<GhIssueComment[]> {
  return invoke("github_issue_comments", { projectId, number })
}
