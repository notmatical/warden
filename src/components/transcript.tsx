import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { AlertTriangle, Check, Copy, Info } from "lucide-react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { Markdown } from "@/components/ui/markdown"
import { StreamingStatus } from "@/components/streaming-status"
import { ToolActivity } from "@/components/tool-activity"
import { cn } from "@/lib/utils"
import { relativeTime } from "@/lib/time"
import { useAppStore } from "@/store/app-store"
import type { EventRecord } from "@/types"

/** Hover-revealed footer under a message: copy-to-clipboard + a humanized time. */
function MessageMeta({
  text,
  ts,
  align,
}: {
  text: string
  ts: string
  align: "start" | "end"
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 opacity-0 transition-opacity group-hover/msg:opacity-100",
        align === "end" ? "justify-end" : "justify-start"
      )}
    >
      <button
        type="button"
        aria-label="Copy message"
        title="Copy message"
        onClick={() => {
          void navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
        className="flex size-5 items-center justify-center rounded text-muted-foreground/60 transition hover:bg-muted hover:text-foreground"
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </button>
      <span className="text-[11px] text-muted-foreground/50 tabular-nums">
        {relativeTime(ts)}
      </span>
    </div>
  )
}

function UserBubble({ text, ts }: { text: string; ts: string }) {
  return (
    <div className="group/msg flex flex-col items-end gap-1">
      <div className="max-w-[85%] rounded-md bg-secondary px-3.5 py-2 text-sm whitespace-pre-wrap text-secondary-foreground">
        {text}
      </div>
      <MessageMeta text={text} ts={ts} align="end" />
    </div>
  )
}

function AssistantMessage({ text, ts }: { text: string; ts?: string }) {
  return (
    <div className="group/msg flex flex-col gap-1">
      <div className="text-sm text-foreground">
        <Markdown>{text}</Markdown>
      </div>
      {ts ? <MessageMeta text={text} ts={ts} align="start" /> : null}
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
      <Info className="size-3.5 shrink-0" />
      <span>{text}</span>
    </div>
  )
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span className="whitespace-pre-wrap">{message}</span>
    </div>
  )
}

const TOOL_TYPES = new Set(["thinking", "tool_use", "tool_result"])

function renderStandalone(event: EventRecord): ReactNode {
  switch (event.type) {
    case "session_init":
      // Internal metadata — not shown in the transcript.
      return null
    case "user_message":
      return <UserBubble key={event.id} text={event.text} ts={event.ts} />
    case "assistant_text":
      return <AssistantMessage key={event.id} text={event.text} ts={event.ts} />
    case "notice":
      return <Notice key={event.id} text={event.text} />
    case "error":
      return <ErrorRow key={event.id} message={event.message} />
    case "result":
      // The live timer covers in-progress turns; a finished turn only surfaces
      // here if it failed.
      return event.is_error ? (
        <ErrorRow key={event.id} message="Turn failed" />
      ) : null
    default:
      return null
  }
}

/** Render the event log, collapsing contiguous tool/thinking events into a
 *  single `ToolActivity` accordion between assistant/user messages. */
function renderTimeline(events: EventRecord[]): ReactNode[] {
  const nodes: ReactNode[] = []
  let toolRun: EventRecord[] = []

  const flush = () => {
    if (toolRun.length > 0) {
      nodes.push(
        <ToolActivity key={`tools-${toolRun[0].id}`} items={toolRun} />
      )
      toolRun = []
    }
  }

  for (const event of events) {
    if (TOOL_TYPES.has(event.type)) {
      toolRun.push(event)
      continue
    }
    flush()
    const node = renderStandalone(event)
    if (node) nodes.push(node)
  }
  flush()

  return nodes
}

export function Transcript({ sessionId }: { sessionId: string }) {
  const events = useAppStore((s) => s.eventsBySession[sessionId])
  const streaming = useAppStore((s) => s.streamingBySession[sessionId])
  const loading = useAppStore((s) => s.loadingEventsBySession[sessionId])

  // Memoized so streaming deltas (which only touch `streaming`) don't re-walk
  // the whole event log every tick.
  const timeline = useMemo(
    () => (events ? renderTimeline(events) : null),
    [events]
  )

  const viewportRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)

  const eventCount = events?.length ?? 0
  const streamLength = streaming?.length ?? 0

  const handleScroll = () => {
    const el = viewportRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    pinnedRef.current = distance < 80
  }

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (el && pinnedRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [eventCount, streamLength])

  useEffect(() => {
    pinnedRef.current = true
    const el = viewportRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [sessionId])

  const isEmpty = eventCount === 0 && !streaming

  return (
    <ScrollArea
      className="h-full"
      viewportRef={viewportRef}
      onScrollCapture={handleScroll}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 pb-32">
        {isEmpty && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {loading ? "Loading transcript…" : "No messages yet."}
          </p>
        )}
        {timeline}
        {streaming && <AssistantMessage text={streaming} />}
        <StreamingStatus sessionId={sessionId} />
      </div>
    </ScrollArea>
  )
}
