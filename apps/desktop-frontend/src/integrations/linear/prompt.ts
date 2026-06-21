import type { LinearComment, LinearIssue } from "./types"

const MAX_COMMENTS = 20

/** Minimal escaping for XML attribute values (double-quoted). */
function attr(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
}

/** The first message for a session spawned from a Linear issue, matching
 *  Linear's own "Copy as prompt" output: an <issue> envelope with the raw
 *  markdown body, followed by <comment-thread> blocks. */
export function buildIssuePrompt(
  issue: LinearIssue,
  comments: LinearComment[]
): string {
  const lines = [
    `Work on Linear issue ${issue.identifier}:`,
    "",
    `<issue identifier="${attr(issue.identifier)}" url="${attr(issue.url)}">`,
    `<title>${issue.title}</title>`,
  ]

  if (issue.description?.trim()) {
    lines.push("<description>", issue.description.trim(), "</description>")
  }

  lines.push(`<team name="${attr(issue.team.name)}"/>`)
  if (issue.project) lines.push(`<project name="${attr(issue.project.name)}"/>`)
  lines.push("</issue>")

  if (comments.length > 0) {
    const recent = comments.slice(-MAX_COMMENTS)
    lines.push("")
    if (comments.length > recent.length)
      lines.push("<!-- earlier comments omitted -->")
    for (const c of recent) {
      const author = attr(c.user?.name ?? "Unknown")
      lines.push(
        `<comment-thread comment-id="${attr(c.id)}"><comment author="${author}" created-at="${attr(c.createdAt)}">${c.body.trim()}</comment></comment-thread>`
      )
    }
  }

  return lines.join("\n")
}
