import type { LinearComment, LinearIssue } from "./types"

const PRIORITY: Record<number, string> = {
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
}

const MAX_COMMENTS = 20

/** The first message for a session spawned from a Linear issue: the full task
 *  as agent-readable markdown. Empty sections are omitted rather than noted. */
export function buildIssuePrompt(
  issue: LinearIssue,
  comments: LinearComment[]
): string {
  const meta = [
    `- Linear: ${issue.url}`,
    `- State: ${issue.state.name}`,
    PRIORITY[issue.priority] && `- Priority: ${PRIORITY[issue.priority]}`,
    `- Team: ${issue.team.name} (${issue.team.key})`,
    issue.project && `- Project: ${issue.project.name}`,
    issue.labels.length > 0 && `- Labels: ${issue.labels.join(", ")}`,
    issue.assignee && `- Assignee: ${issue.assignee.name}`,
  ].filter(Boolean)

  const parts = [
    "Work on this Linear issue.",
    `# ${issue.identifier} — ${issue.title}`,
    meta.join("\n"),
  ]

  if (issue.description?.trim()) {
    parts.push("## Description", issue.description.trim())
  }

  if (comments.length > 0) {
    const recent = comments.slice(-MAX_COMMENTS)
    const lines = recent.map((c) => {
      const who = c.user?.name ?? "Unknown"
      const when = c.createdAt.slice(0, 10)
      return `**${who} — ${when}:**\n${c.body.trim()}`
    })
    if (comments.length > recent.length)
      lines.unshift("_(earlier comments omitted)_")
    parts.push("## Comments", lines.join("\n\n"))
  }

  return parts.join("\n\n")
}
