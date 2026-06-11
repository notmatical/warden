import type { Element } from "hast"
import { Check, Copy } from "lucide-react"
import {
  type CSSProperties,
  memo,
  type ReactNode,
  useEffect,
  useState,
} from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import rehypeRaw from "rehype-raw"
import remarkGfm from "remark-gfm"

import { copyText } from "@/lib/clipboard"
import { highlightCode } from "@/lib/shiki"
import { cn } from "@/lib/utils"

/** Recursively flatten a React node tree to its text content. */
function nodeText(node: ReactNode): string {
  if (node == null || node === false) return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join("")
  if (typeof node === "object" && "props" in node) {
    return nodeText(
      (node as { props: { children?: ReactNode } }).props.children
    )
  }
  return ""
}

/** Whether a task-list `<li>` hast node contains a checked checkbox. */
function taskChecked(node: Element | undefined): boolean {
  return (
    node?.children.some(
      (child) =>
        child.type === "element" &&
        child.tagName === "input" &&
        Boolean(child.properties?.checked)
    ) ?? false
  )
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label="Copy code"
      onClick={async () => {
        if (await copyText(value, "")) {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }
      }}
      className="absolute top-2 right-2 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-background/80 hover:text-foreground"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  )
}

/** A fenced code block: Shiki-highlighted with a plain `<pre>` fallback while
 *  highlighting resolves (or if the grammar is unknown). */
function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void highlightCode(code, lang).then((result) => {
      if (active) setHtml(result)
    })
    return () => {
      active = false
    }
  }, [code, lang])

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-border bg-card text-[0.8125rem]">
      {html ? (
        <div
          className="overflow-x-auto [&>pre]:!bg-transparent [&>pre]:px-4 [&>pre]:py-3 [&>pre]:leading-[1.55]"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki output is sanitized HTML
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto px-4 py-3 font-mono leading-[1.55]">
          {code}
        </pre>
      )}
      <CopyButton value={code} />
    </div>
  )
}

/** A GFM task-list checkbox, replacing the native disabled `<input>` with a
 *  filled check (done) or hollow ring (todo) so it reads like a real to-do. */
function TaskMarker({ checked }: { checked: boolean }) {
  return checked ? (
    <span className="mt-[0.2em] flex size-[1.05em] shrink-0 items-center justify-center rounded-full bg-foreground text-background">
      <Check className="size-[0.72em]" strokeWidth={3.5} />
    </span>
  ) : (
    <span className="mt-[0.2em] size-[1.05em] shrink-0 rounded-full border border-muted-foreground/50" />
  )
}

const COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="mt-6 mb-3 text-[1.45rem] leading-tight font-semibold tracking-tight text-foreground">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-6 mb-3 text-[1.2rem] leading-snug font-semibold tracking-tight text-foreground">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-5 mb-2 text-[1.025rem] leading-snug font-semibold text-foreground">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-4 mb-2 text-[0.9rem] font-semibold text-foreground">
      {children}
    </h4>
  ),
  h5: ({ children }) => (
    <h5 className="mt-4 mb-1.5 text-[0.8125rem] font-semibold text-foreground">
      {children}
    </h5>
  ),
  h6: ({ children }) => (
    <h6 className="mt-4 mb-1.5 text-[0.75rem] font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </h6>
  ),
  p: ({ children }) => <p className="my-3 leading-[1.7]">{children}</p>,
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => (
    <del className="text-muted-foreground line-through">{children}</del>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium text-foreground underline decoration-border decoration-1 underline-offset-2 transition-colors hover:decoration-foreground"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-6 border-border" />,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-border pl-4 text-muted-foreground">
      {children}
    </blockquote>
  ),
  ul: ({ children, className }) => (
    <ul
      className={cn(
        "my-3 space-y-1.5",
        // remark-gfm tags task lists; those rows manage their own markers.
        className?.includes("contains-task-list")
          ? "list-none pl-0"
          : "list-disc pl-5 marker:text-muted-foreground"
      )}
    >
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 list-decimal space-y-1.5 pl-5 marker:text-muted-foreground">
      {children}
    </ol>
  ),
  li: ({ children, className, node }) => {
    if (className?.includes("task-list-item")) {
      // The native <input> is swapped for a <span> marker, so read the
      // checked state straight off the hast node to mute completed rows.
      const done = taskChecked(node)
      return (
        <li
          className={cn(
            "flex list-none items-start gap-2.5",
            done && "text-muted-foreground line-through decoration-1"
          )}
        >
          {children}
        </li>
      )
    }
    return (
      <li className="pl-1 leading-[1.6] [&>ol]:mt-1.5 [&>ul]:mt-1.5">
        {children}
      </li>
    )
  },
  input: ({ type, checked }) =>
    type === "checkbox" ? <TaskMarker checked={Boolean(checked)} /> : null,
  // Segmented "tile" table: border-separate + spacing turns every cell into its
  // own rounded fill with a small gap, instead of one continuous bordered grid.
  table: ({ children }) => (
    <div className="my-4 w-full overflow-x-auto">
      <table className="w-full border-separate border-spacing-0.5 text-[0.8125rem]">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children, style }) => (
    <th
      style={style as CSSProperties}
      className="rounded-md bg-muted px-3 py-2 text-left align-top font-semibold text-foreground"
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td
      style={style as CSSProperties}
      className="rounded-md bg-muted/40 px-3 py-2 align-top"
    >
      {children}
    </td>
  ),
  code({ className, children }) {
    const match = /language-(\w+)/.exec(className ?? "")
    const text = nodeText(children)
    const isBlock = match != null || text.includes("\n")
    if (isBlock) {
      return <CodeBlock code={text.replace(/\n$/, "")} lang={match?.[1]} />
    }
    return (
      <code className="rounded-[0.3rem] bg-foreground/15 px-[0.35em] py-[0.1em] font-mono text-[0.85em] text-foreground">
        {children}
      </code>
    )
  },
  // CodeBlock renders its own framed `<pre>`, so collapse the wrapper.
  pre: ({ children }) => <>{children}</>,
}

export const Markdown = memo(function Markdown({
  children,
  className,
}: {
  children: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "markdown min-w-0 text-[0.9375rem] leading-[1.7] font-[450] break-words text-foreground/90",
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={COMPONENTS}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
})
