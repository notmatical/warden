import { type CSSProperties, useMemo, useRef } from "react"

import {
  PREVIEW_ROWS,
  useHighlighted,
  useNearViewport,
} from "@/components/ui/diff-view"
import { langFromPath } from "@/lib/shiki"
import { cn } from "@/lib/utils"

interface CodeRow {
  /** Gutter line number; absent for unnumbered interstitial lines. */
  num?: number
  text: string
}

/** A Read result's `cat -n`-style line prefix: leading spaces, a line number,
 *  then a tab or `→` separator. */
const NUMBERED = /^\s*(\d+)(?:\t|→)(.*)$/

/** Split tool output into gutter-numbered code rows. When most lines carry a
 *  `cat -n`/`→` prefix (a Read result), the embedded numbers become the gutter
 *  and are stripped from the code; otherwise lines number sequentially from 1. */
function parseCode(text: string): CodeRow[] {
  const lines = text.replace(/\n$/, "").split("\n")
  let numbered = 0
  for (const line of lines) {
    if (NUMBERED.test(line)) numbered++
  }
  if (numbered >= Math.max(1, Math.ceil(lines.length / 2))) {
    return lines.map((line) => {
      const m = NUMBERED.exec(line)
      return m ? { num: Number(m[1]), text: m[2] } : { text: line }
    })
  }
  return lines.map((line, i) => ({ num: i + 1, text: line }))
}

/** Past this many lines, skip tokenization — the panel scrolls plain text
 *  instead of stalling the highlighter on a giant Read. */
const HIGHLIGHT_LIMIT = 2000

const NO_CODE: string[] = []

/** Line-numbered, syntax-highlighted code body — the diff renderer's styling
 *  without the +/− gutter. Used for Read results and other code-shaped output. */
export function CodeLines({
  text,
  path,
  lang,
}: {
  text: string
  path?: string
  lang?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const near = useNearViewport(containerRef)
  const rows = useMemo(() => parseCode(text), [text])
  const code = useMemo(() => rows.map((r) => r.text), [rows])
  const oversized = rows.length > HIGHLIGHT_LIMIT
  // Far offscreen: plain text, truncated rows — tokenize + fill in on approach.
  const hl = useHighlighted(
    near && !oversized ? code : NO_CODE,
    oversized ? "text" : (lang ?? langFromPath(path))
  )
  const shown = near ? rows : rows.slice(0, PREVIEW_ROWS)

  return (
    <div
      ref={containerRef}
      className="w-max min-w-full bg-card font-mono text-sm leading-[1.55] text-foreground"
    >
      {shown.map((row, i) => {
        const tokens = hl?.lines[i]
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: code rows are positional
            key={i}
            className="flex"
          >
            <span className="w-11 shrink-0 pr-2 text-right text-[12px] text-muted-foreground/45 tabular-nums select-none">
              {row.num ?? ""}
            </span>
            <code className="flex-1 pr-4 pl-2 whitespace-pre">
              {tokens
                ? tokens.map((t, ti) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional
                      key={ti}
                      data-tok
                      style={t.style as CSSProperties | undefined}
                    >
                      {t.content}
                    </span>
                  ))
                : row.text || " "}
            </code>
          </div>
        )
      })}
    </div>
  )
}

/** A self-contained code panel: file-path header over a scrollable, capped,
 *  highlighted body — the code twin of `DiffView`. */
export function CodeView({
  path,
  pathTitle,
  text,
  className,
}: {
  path?: string
  pathTitle?: string
  text: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-border/60 bg-card",
        className
      )}
    >
      {path ? (
        <div
          className="truncate border-b border-border/60 bg-muted/30 px-3 py-1.5 font-mono text-sm text-muted-foreground/80"
          title={pathTitle ?? path}
        >
          {path}
        </div>
      ) : null}
      <div className="max-h-72 overflow-auto py-1.5 [contain-intrinsic-size:auto_18rem] [content-visibility:auto]">
        <CodeLines text={text} path={pathTitle ?? path} />
      </div>
    </div>
  )
}
