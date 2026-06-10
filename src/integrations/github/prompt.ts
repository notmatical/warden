import type { GhIssueComment, RepoIssue } from "./types"

const MAX_COMMENTS = 20

/** Minimal escaping for XML attribute values (double-quoted). */
function attr(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
}

/** The first message for a session spawned from a GitHub issue — the same
 *  envelope shape as the Linear prompt so agents see one consistent format. */
export function buildGithubIssuePrompt(
  issue: RepoIssue,
  comments: GhIssueComment[]
): string {
  const lines = [
    `Work on GitHub issue #${issue.number} in ${issue.projectName}:`,
    "",
    `<issue number="${issue.number}" url="${attr(issue.url)}">`,
    `<title>${issue.title}</title>`,
  ]

  if (issue.body.trim()) {
    lines.push("<description>", issue.body.trim(), "</description>")
  }

  if (issue.labels.length > 0)
    lines.push(`<labels>${attr(issue.labels.join(", "))}</labels>`)
  lines.push("</issue>")

  if (comments.length > 0) {
    const recent = comments.slice(-MAX_COMMENTS)
    lines.push("")
    if (comments.length > recent.length)
      lines.push("<!-- earlier comments omitted -->")
    for (const c of recent) {
      lines.push(
        `<comment author="${attr(c.author)}" created-at="${attr(c.createdAt)}">${c.body.trim()}</comment>`
      )
    }
  }

  return lines.join("\n")
}
