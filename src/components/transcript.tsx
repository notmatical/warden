import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react"
import { AlertTriangle, Info } from "lucide-react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { Markdown } from "@/components/ui/markdown"
import { ToolActivity } from "@/components/tool-activity"
import { cn } from "@/lib/utils"
import { formatCost, formatDuration } from "@/lib/format"
import { useAppStore } from "@/store/app-store"
import type { EventRecord } from "@/types"

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl bg-primary px-3.5 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
        {text}
      </div>
    </div>
  )
}

function AssistantMessage({
  text,
  streaming,
}: {
  text: string
  streaming?: boolean
}) {
  return (
    <div className="text-sm text-foreground">
      <Markdown>{text}</Markdown>
      {streaming && (
        <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-foreground/60 align-text-bottom" />
      )}
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

function ResultChip({
  cost,
  duration,
  turns,
  isError,
}: {
  cost: number | null
  duration: number | null
  turns: number | null
  isError: boolean
}) {
  return (
    <div className="flex justify-center">
      <div
        className={cn(
          "flex items-center gap-3 rounded-full border px-3 py-1 text-[11px]",
          isError
            ? "border-destructive/40 text-destructive"
            : "border-border/70 text-muted-foreground"
        )}
      >
        <span>{isError ? "Turn failed" : "Turn complete"}</span>
        {cost !== null && <span>{formatCost(cost)}</span>}
        {duration !== null && <span>{formatDuration(duration)}</span>}
        {turns !== null && <span>{turns} turns</span>}
      </div>
    </div>
  )
}

const TOOL_TYPES = new Set(["thinking", "tool_use", "tool_result"])

function renderStandalone(event: EventRecord): ReactNode {
  switch (event.type) {
    case "session_init":
      return (
        <Notice
          key={event.id}
          text={`Session initialized${event.model ? ` · ${event.model}` : ""}`}
        />
      )
    case "user_message":
      return <UserBubble key={event.id} text={event.text} />
    case "assistant_text":
      return <AssistantMessage key={event.id} text={event.text} />
    case "notice":
      return <Notice key={event.id} text={event.text} />
    case "error":
      return <ErrorRow key={event.id} message={event.message} />
    case "result":
      return (
        <ResultChip
          key={event.id}
          cost={event.cost_usd}
          duration={event.duration_ms}
          turns={event.num_turns}
          isError={event.is_error}
        />
      )
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
        {events && renderTimeline(events)}
        {streaming && <AssistantMessage text={streaming} streaming />}
      </div>
    </ScrollArea>
  )
}
