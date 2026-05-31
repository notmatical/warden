import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { AlertTriangle, ChevronRight, Info, Sparkles } from "lucide-react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { ToolCall } from "@/components/tool-call"
import { cn } from "@/lib/utils"
import { formatCost, formatDuration } from "@/lib/format"
import { useAppStore } from "@/store/app-store"
import type { EventRecord } from "@/types"

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-md bg-primary px-3.5 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
        {text}
      </div>
    </div>
  )
}

function AssistantBubble({
  text,
  streaming,
}: {
  text: string
  streaming?: boolean
}) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-md bg-muted px-3.5 py-2 text-sm whitespace-pre-wrap text-foreground">
        {text}
        {streaming && (
          <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-foreground/60 align-text-bottom" />
        )}
      </div>
    </div>
  )
}

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-sm border border-dashed border-border/70 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-muted-foreground"
        aria-expanded={open}
      >
        <Sparkles className="size-3.5" />
        <span className="italic">Thinking</span>
        <ChevronRight
          className={cn(
            "ml-auto size-3.5 transition-transform",
            open && "rotate-90"
          )}
        />
      </button>
      {open && (
        <p className="border-t border-border/70 px-3 py-2 whitespace-pre-wrap text-muted-foreground italic">
          {text}
        </p>
      )}
    </div>
  )
}

function ToolResult({
  content,
  isError,
}: {
  content: string
  isError: boolean
}) {
  const [open, setOpen] = useState(isError)
  return (
    <div
      className={cn(
        "rounded-sm border text-xs",
        isError
          ? "border-destructive/40 bg-destructive/10"
          : "border-border/70 bg-muted/30"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-1.5 text-left",
          isError ? "text-destructive" : "text-muted-foreground"
        )}
        aria-expanded={open}
      >
        <span className="font-medium">
          {isError ? "Tool error" : "Tool result"}
        </span>
        <ChevronRight
          className={cn(
            "ml-auto size-3.5 transition-transform",
            open && "rotate-90"
          )}
        />
      </button>
      {open && (
        <pre
          className={cn(
            "overflow-x-auto border-t px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap",
            isError
              ? "border-destructive/40 text-destructive"
              : "border-border/70 text-muted-foreground"
          )}
        >
          {content}
        </pre>
      )}
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-sm bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
      <Info className="size-3.5 shrink-0" />
      <span>{text}</span>
    </div>
  )
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
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

function renderEvent(event: EventRecord) {
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
      return <AssistantBubble key={event.id} text={event.text} />
    case "thinking":
      return <Thinking key={event.id} text={event.text} />
    case "tool_use":
      return <ToolCall key={event.id} name={event.name} input={event.input} />
    case "tool_result":
      return (
        <ToolResult
          key={event.id}
          content={event.content}
          isError={event.is_error}
        />
      )
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
    case "text_delta":
      return null
    default:
      return null
  }
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
      <div className="flex flex-col gap-3 p-4">
        {isEmpty && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {loading ? "Loading transcript…" : "No messages yet."}
          </p>
        )}
        {events?.map(renderEvent)}
        {streaming && <AssistantBubble text={streaming} streaming />}
      </div>
    </ScrollArea>
  )
}
