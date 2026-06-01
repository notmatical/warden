import { Fragment, type ReactNode } from "react"

import { cn } from "@/lib/utils"

// `@file`, `/command`, `#ref` at line start or after whitespace.
const TOKEN_RE = /(^|\s)([@/#][^\s]+)/g

const TOKEN_COLOR: Record<string, string> = {
  "@": "text-sky-400",
  "/": "text-violet-400",
  "#": "text-emerald-400",
}

/**
 * Renders the composer text with mention tokens colored. Used as a backdrop
 * behind a transparent textarea so the highlight lines up with what's typed.
 */
export function MentionHighlight({ value }: { value: string }) {
  const nodes: ReactNode[] = []
  let last = 0
  let key = 0
  let match: RegExpExecArray | null

  TOKEN_RE.lastIndex = 0
  while ((match = TOKEN_RE.exec(value)) !== null) {
    const tokenStart = match.index + match[1].length
    if (tokenStart > last) {
      nodes.push(<Fragment key={key++}>{value.slice(last, tokenStart)}</Fragment>)
    }
    const token = match[2]
    nodes.push(
      <span
        key={key++}
        className={cn("font-medium", TOKEN_COLOR[token[0]] ?? "text-foreground")}
      >
        {token}
      </span>
    )
    last = tokenStart + token.length
  }

  if (last < value.length) {
    nodes.push(<Fragment key={key++}>{value.slice(last)}</Fragment>)
  }
  // Zero-width char keeps a trailing newline's height in sync with the textarea.
  nodes.push("​")

  return <>{nodes}</>
}
