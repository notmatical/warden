import {
  AlertTriangle,
  Check,
  Copy,
  Info,
  MessageSquarePlus,
} from "lucide-react"
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { AskUserQuestion, parseQuestions } from "@/components/ask-user-question"
import { JumpToLatest } from "@/components/jump-to-latest"
import { PlanApproval } from "@/components/plan-approval"
import { StreamingStatus } from "@/components/streaming-status"
import { ToolActivity } from "@/components/tool-activity"
import { Markdown } from "@/components/ui/markdown"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  hasPendingQuestion,
  isSpecialTool,
  resolvePlanContent,
} from "@/lib/agent-tools"
import { copyText } from "@/lib/clipboard"
import { relativeTime } from "@/lib/time"
import { cn } from "@/lib/utils"
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
        onClick={async () => {
          if (await copyText(text, "")) {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }
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
      <div className="max-w-[85%] rounded-lg bg-secondary px-4 py-2.5 text-[0.9375rem] leading-[1.65] whitespace-pre-wrap text-secondary-foreground">
        {text}
      </div>
      <MessageMeta text={text} ts={ts} align="end" />
    </div>
  )
}

function AssistantMessage({ text, ts }: { text: string; ts?: string }) {
  return (
    <div className="group/msg flex flex-col gap-1">
      <Markdown>{text}</Markdown>
      {ts ? <MessageMeta text={text} ts={ts} align="start" /> : null}
    </div>
  )
}

/** Floating Normal/Verbose switch for transcript detail (persisted globally). */
function ViewToggle() {
  const view = useAppStore((s) => s.transcriptView)
  const setView = useAppStore((s) => s.setTranscriptView)
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-background/85 p-0.5 shadow-sm backdrop-blur">
      {(["normal", "verbose"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => setView(mode)}
          aria-pressed={view === mode}
          className={cn(
            "rounded-[5px] px-2 py-0.5 text-[11px] font-medium capitalize transition-colors",
            view === mode
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {mode}
        </button>
      ))}
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
      <Info className="size-3.5 shrink-0" />
      <span>{text}</span>
    </div>
  )
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
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
    case "permission_request":
      // Surfaced live above the composer, not in the transcript history.
      return null
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

/** An agent's AskUserQuestion tool call, rendered interactively. Answering sends
 *  the selections back as the next user message — the agent paused right after
 *  asking, so it continues on the reply (no tool_result needed). */
function QuestionBlock({
  event,
  sessionId,
  answered,
}: {
  event: EventRecord
  sessionId: string
  answered: boolean
}) {
  const sendMessage = useAppStore((s) => s.sendMessage)
  if (event.type !== "tool_use") return null
  return (
    <AskUserQuestion
      questions={parseQuestions(event.input)}
      answered={answered}
      onSubmit={(reply) => void sendMessage(sessionId, reply)}
    />
  )
}

/** An agent's ExitPlanMode tool call, rendered as a reviewable plan. Approving
 *  flips the session out of plan mode and resumes it to implement; the agent
 *  paused after presenting, so it continues on the approval message. */
function PlanBlock({
  event,
  sessionId,
  answered,
  autoAccepted,
}: {
  event: EventRecord
  sessionId: string
  answered: boolean
  autoAccepted?: boolean
}) {
  const approvePlan = useAppStore((s) => s.approvePlan)
  if (event.type !== "tool_use") return null
  return (
    <PlanApproval
      plan={resolvePlanContent(event.input)}
      answered={answered}
      autoAccepted={autoAccepted}
      onApprove={() => void approvePlan(sessionId)}
    />
  )
}

/** True if the user sends a message anywhere after index `i` — i.e. an
 *  AskUserQuestion at `i` has since been answered. */
function repliedAfter(events: EventRecord[], i: number): boolean {
  for (let j = i + 1; j < events.length; j++) {
    if (events[j].type === "user_message") return true
  }
  return false
}

/** Walk the event log into renderable nodes:
 *  - runs of thinking/tool events collapse into one `ToolActivity` accordion;
 *  - special tools (currently AskUserQuestion) are lifted into dedicated widgets
 *    and kept out of the accordion;
 *  - an AskUserQuestion's auto-generated error result is dropped, and the prose
 *    the agent tends to restate the question with afterwards is hidden until the
 *    user replies;
 *  - everything else renders standalone. */
function renderTimeline(
  events: EventRecord[],
  sessionId: string,
  autoAcceptPlan: boolean,
  workingDir?: string
): ReactNode[] {
  const nodes: ReactNode[] = []
  const droppedResults = new Set<string>()
  let toolRun: EventRecord[] = []
  let awaitingReply = false // inside an unanswered AskUserQuestion
  let pendingPlan = false // stopped on an unapproved plan, awaiting approval

  const flushTools = () => {
    if (toolRun.length === 0) return
    nodes.push(
      <ToolActivity
        key={`tools-${toolRun[0].id}`}
        items={toolRun}
        workingDir={workingDir}
      />
    )
    toolRun = []
  }

  events.forEach((event, i) => {
    // A reply closes the open question/plan, re-enabling assistant text.
    if (event.type === "user_message") {
      awaitingReply = false
      pendingPlan = false
    }
    if (event.type === "assistant_text" && awaitingReply) return
    // A subagent's narration is folded under its Task (its tools nest in the
    // accordion); don't render it standalone, and don't break the tool run.
    if (event.type === "assistant_text" && event.parent_tool_use_id) return
    if (event.type === "tool_result" && droppedResults.has(event.tool_use_id)) {
      return
    }
    // A plan pause ends the turn with an error result (ExitPlanMode was
    // "denied"); that's expected, not a failure — don't render it as one.
    if (event.type === "result" && event.is_error && pendingPlan) return

    // Special tools lift out into their own widget. Only AskUserQuestion has
    // one today; future ones (plan/todo) add a branch here. Anything in the
    // registry without a branch falls through to the accordion below, so it
    // stays visible rather than silently vanishing.
    if (event.type === "tool_use" && isSpecialTool(event.name)) {
      if (event.name === "AskUserQuestion") {
        flushTools()
        droppedResults.add(event.id)
        awaitingReply = true
        nodes.push(
          <QuestionBlock
            key={`q-${event.id}`}
            event={event}
            sessionId={sessionId}
            answered={repliedAfter(events, i)}
          />
        )
        return
      }
      if (event.name === "ExitPlanMode") {
        // The plan lives in the call's input; drop its auto-denied result.
        // In a workflow the plan is auto-accepted (handed to the next node),
        // so never show approval controls — they'd wrongly resume this node.
        flushTools()
        droppedResults.add(event.id)
        const planAnswered = autoAcceptPlan || repliedAfter(events, i)
        pendingPlan = !planAnswered
        nodes.push(
          <PlanBlock
            key={`plan-${event.id}`}
            event={event}
            sessionId={sessionId}
            answered={planAnswered}
            autoAccepted={autoAcceptPlan}
          />
        )
        return
      }
    }

    if (TOOL_TYPES.has(event.type)) {
      toolRun.push(event)
      return
    }
    flushTools()
    const node = renderStandalone(event)
    if (node) nodes.push(node)
  })
  flushTools()

  return nodes
}

export function Transcript({
  sessionId,
  bottomInset,
}: {
  sessionId: string
  bottomInset: number
}) {
  const events = useAppStore((s) => s.eventsBySession[sessionId])
  const streaming = useAppStore((s) => s.streamingBySession[sessionId])
  const loading = useAppStore((s) => s.loadingEventsBySession[sessionId])
  // Workflow node sessions auto-accept their plan (handed to the next node).
  const isWorkflowSession = useAppStore(
    (s) => s.sessions[sessionId]?.workflowId != null
  )
  const workingDir = useAppStore((s) => s.sessions[sessionId]?.workingDir)

  // Memoized so streaming deltas (which only touch `streaming`) don't re-walk
  // the whole event log every tick.
  const timeline = useMemo(
    () =>
      events
        ? renderTimeline(events, sessionId, isWorkflowSession, workingDir)
        : null,
    [events, sessionId, isWorkflowSession, workingDir]
  )

  // An AskUserQuestion is awaiting a reply: the agent sometimes keeps narrating
  // afterwards, which would stream in and then vanish when its finalized text is
  // suppressed. Hide the live stream too so it never flickers.
  const pendingQuestion = useMemo(() => hasPendingQuestion(events), [events])

  const viewportRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  // Mirrors `pinnedRef` as state so the "jump to latest" pill can react to it
  // (the ref alone never re-renders).
  const [atBottom, setAtBottom] = useState(true)

  const eventCount = events?.length ?? 0

  const handleScroll = () => {
    const el = viewportRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const pinned = distance < 80
    pinnedRef.current = pinned
    setAtBottom((prev) => (prev === pinned ? prev : pinned))
  }

  const scrollToBottom = () => {
    const el = viewportRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    pinnedRef.current = true
    setAtBottom(true)
  }

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (el && pinnedRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [])

  useEffect(() => {
    pinnedRef.current = true
    const el = viewportRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [])

  const isEmpty = eventCount === 0 && !streaming

  return (
    <div className="relative h-full">
      <ScrollArea
        className="h-full"
        // Radix wraps content in a `display:table` element that grows to its
        // widest child, which lets wide code/diffs/plans push the column off
        // screen. Force it to block so children honor their `min-w-0` and scroll
        // internally instead.
        viewportClassName="[&>div]:!block [&>div]:!min-w-0"
        viewportRef={viewportRef}
        onScrollCapture={handleScroll}
      >
        <div
          className="mx-auto flex w-full max-w-6xl flex-col gap-2.5 px-4 pt-8"
          style={{ paddingBottom: bottomInset }}
        >
          {timeline}
          {streaming && !pendingQuestion && (
            <AssistantMessage text={streaming} />
          )}
          <StreamingStatus sessionId={sessionId} />
        </div>
      </ScrollArea>

      {/* Transcript detail switch, floating over the top-right corner. */}
      {isEmpty ? null : (
        <div className="absolute top-2 right-4 z-10">
          <ViewToggle />
        </div>
      )}

      {/* Floating pill, centered just above the composer. Pulses while output
          streams in below the fold. */}
      <div
        className="pointer-events-none absolute inset-x-0 flex justify-center"
        style={{ bottom: bottomInset + 12 }}
      >
        <JumpToLatest
          visible={!atBottom}
          active={!!streaming}
          onClick={scrollToBottom}
          className="pointer-events-auto"
        />
      </div>

      {/* Centered in the space above the floating composer (so it doesn't
			    depend on the scroll area's height chain). */}
      {isEmpty ? (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center px-4 text-center"
          style={{ bottom: bottomInset }}
        >
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading transcript…</p>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="flex size-14 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <MessageSquarePlus className="size-6" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-medium">No messages yet</h2>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Send a message below to start the conversation.
                </p>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
