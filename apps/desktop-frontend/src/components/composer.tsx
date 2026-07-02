import { CornerDownLeft, GitMerge, Square } from "lucide-react"
import {
  type KeyboardEvent,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"
import { AgentToolbar } from "@/components/agent-panel"
import { AttachmentRow } from "@/components/attachment-row"
import { ContextMeter } from "@/components/context-meter"
import { EffortSelector } from "@/components/selectors/effort-selector"
import { ModeSelector } from "@/components/selectors/mode-selector"
import { ModelSelector } from "@/components/selectors/model-selector"
import { GitStatusChips } from "@/components/git-status-chips"
import { MentionHighlight } from "@/components/mention-highlight"
import { MentionPopover } from "@/components/mention-popover"
import { PermissionApproval } from "@/components/permission-approval"
import { Button } from "@/components/ui/button"
import { useFileDrop } from "@/hooks/use-file-drop"
import { useGitStatus } from "@/hooks/use-git-status"
import { useMentions } from "@/hooks/use-mentions"
import { useUiCommand } from "@/hooks/use-ui-command"
import * as ipc from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"
import type { Attachment } from "@/types"

const MAX_TEXTAREA_HEIGHT = 200
// Shared typography/padding so the highlight backdrop lines up with the textarea.
// Shared box + typography + wrapping so the backdrop and textarea lay text out
// identically (any divergence shifts the caret off the highlighted token).
const INPUT_BOX =
  "py-3 pr-1 pl-3.5 text-sm leading-5 tracking-normal break-words whitespace-pre-wrap"

export function Composer({ sessionId }: { sessionId: string }) {
  const session = useAppStore((s) => s.sessions[sessionId])
  const sendMessage = useAppStore((s) => s.sendMessage)
  const cancel = useAppStore((s) => s.cancel)
  const updateSession = useAppStore((s) => s.updateSession)
  const [value, setValue] = useState("")

  // Drag-and-drop attachments staged for the next message.
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const isDragOver = useFileDrop(dropZoneRef, (paths) => {
    void ipc
      .attachToSession(sessionId, paths)
      .then((staged) => setAttachments((prev) => [...prev, ...staged]))
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : String(error))
      )
  })

  // Only one toolbar menu open at a time.
  const [openMenu, setOpenMenu] = useState<"model" | "mode" | "effort" | null>(
    null
  )
  const menuProps = (id: "model" | "mode" | "effort") => ({
    open: openMenu === id,
    onOpenChange: (open: boolean) => setOpenMenu(open ? id : null),
  })

  // Ctrl+E toggles this session's model menu when it's the active session.
  useUiCommand<string>("composer.toggleModelMenu", (targetSessionId) => {
    if (targetSessionId === sessionId) {
      setOpenMenu((current) => (current === "model" ? null : "model"))
    }
  })
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  const mentions = useMentions({
    value,
    onChange: setValue,
    textareaRef,
    workingDir: session?.workingDir ?? null,
  })

  const { statuses, refresh } = useGitStatus(sessionId)

  // A live tool-approval request: the latest event is a permission_request the
  // user hasn't acted on. While pending it takes the chip row's slot.
  const pendingApproval = useAppStore((s) => {
    const events = s.eventsBySession[sessionId]
    const last = events?.[events.length - 1]
    if (last?.type !== "permission_request") return null
    return s.approvalResolvedBySession[sessionId] === last.id ? null : last
  })
  // ExitPlanMode is approved via the in-transcript plan widget, so drop it from
  // the generic approval bar — otherwise the same denial surfaces twice.
  const approvalDenials = useMemo(
    () =>
      pendingApproval?.denials.filter((d) => d.toolName !== "ExitPlanMode") ??
      [],
    [pendingApproval]
  )
  const showApproval = approvalDenials.length > 0

  // Grow the textarea with its content, from a single line up to a cap.
  const autosize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [])

  // Re-measure on every value change — grow with content up to the cap, then
  // the textarea scrolls.
  // biome-ignore lint/correctness/useExhaustiveDependencies: value drives the re-measure
  useLayoutEffect(() => autosize(), [value, autosize])

  // Re-measure when the pane's width changes (e.g. a split): the initial mount
  // may measure at a transient width and otherwise stay stuck tall. Width-only
  // so resizing the textarea's own height can't feed back into a loop.
  useLayoutEffect(() => {
    const el = textareaRef.current?.parentElement
    if (!el) return
    let lastWidth = el.clientWidth
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== lastWidth) {
        lastWidth = el.clientWidth
        autosize()
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [autosize])

  const running = session?.status === "running"
  const canSend =
    (value.trim().length > 0 || attachments.length > 0) && !running

  if (!session) {
    return null
  }

  // A merged session's worktree is gone — it becomes read-only.
  if (session.mergedAt) {
    return (
      <div className="mx-auto w-full max-w-6xl px-3 pb-3">
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
          <GitMerge className="size-3.5" />
          Merged into {session.baseBranch ?? "base"} · read-only
        </div>
      </div>
    )
  }

  const started = session.turns > 0

  const submit = () => {
    if (!canSend) return
    const text = value.trim()
    const paths = attachments.map((a) => a.path)
    setValue("")
    setAttachments([])
    void sendMessage(sessionId, text, paths.length > 0 ? paths : undefined)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-3 pb-3">
      <div
        ref={dropZoneRef}
        className={cn(
          "flex flex-col rounded-2xl transition-shadow",
          isDragOver &&
            "ring-2 ring-primary/60 ring-offset-2 ring-offset-background"
        )}
      >
        {showApproval && pendingApproval ? (
          <PermissionApproval
            sessionId={sessionId}
            eventId={pendingApproval.id}
            denials={approvalDenials}
          />
        ) : (
          <GitStatusChips
            statuses={statuses}
            sessionId={sessionId}
            refresh={refresh}
          />
        )}
        {/* Input card — solid surface. Attachments stack inside, above the
            textarea; send/stop lives inline on the right. */}
        <div className="relative z-10 flex flex-col rounded-xl border border-border/60 bg-card transition-colors focus-within:border-border/80">
          {mentions.active && (
            <MentionPopover
              items={mentions.items}
              selectedIndex={mentions.selectedIndex}
              loading={mentions.loading}
              emptyLabel={mentions.emptyLabel}
              onSelect={mentions.select}
              onHighlight={mentions.setSelectedIndex}
              className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-md"
            />
          )}
          <AttachmentRow
            items={attachments}
            onRemove={(id) =>
              setAttachments((prev) => prev.filter((a) => a.id !== id))
            }
          />
          {/* Textarea + send/stop, laid out as a row. */}
          <div className="flex items-end gap-1 pr-1.5">
            {/* Highlight backdrop + transparent textarea: mention tokens are
						    colored on the backdrop and show through the textarea. */}
            <div className="relative min-w-0 flex-1">
              <div
                ref={backdropRef}
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-0 overflow-hidden text-foreground",
                  INPUT_BOX
                )}
              >
                <MentionHighlight value={value} />
              </div>
              <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value)
                  mentions.handleInput(
                    e.target.value,
                    e.target.selectionStart ?? 0
                  )
                }}
                onKeyDown={(e) => {
                  if (mentions.handleKeyDown(e)) return
                  handleKeyDown(e)
                }}
                onScroll={(e) => {
                  if (backdropRef.current) {
                    backdropRef.current.scrollTop = e.currentTarget.scrollTop
                  }
                }}
                disabled={running}
                rows={1}
                placeholder={
                  running
                    ? "Agent is working…"
                    : "Message the agent…  (Enter to send)"
                }
                className={cn(
                  "relative block max-h-[200px] w-full resize-none bg-transparent text-transparent caret-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-60",
                  INPUT_BOX
                )}
              />
            </div>
            {running ? (
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => void cancel(sessionId)}
                aria-label="Stop the agent"
                className="mb-1.5 shrink-0 text-muted-foreground hover:text-foreground"
              >
                <Square />
              </Button>
            ) : (
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={submit}
                disabled={!canSend}
                aria-label="Send message"
                className="mb-1.5 shrink-0 text-muted-foreground hover:text-foreground"
              >
                <CornerDownLeft />
              </Button>
            )}
          </div>
        </div>

        {/* Attached settings panel — tucked behind the card, tinted. */}
        <div className="-mt-3 flex items-center gap-1 rounded-b-xl bg-muted/40 px-2 pt-5 pb-1.5">
          <ModelSelector
            value={session.model}
            backend={session.backend}
            started={started}
            onChange={(model) => void updateSession(sessionId, { model })}
            {...menuProps("model")}
          />
          <div className="mx-0.5 h-4 w-px bg-border/60" />
          <ModeSelector
            value={session.permissionMode}
            onChange={(permissionMode) =>
              void updateSession(sessionId, { permissionMode })
            }
            {...menuProps("mode")}
          />
          <EffortSelector
            value={session.effort}
            onChange={(effort) => void updateSession(sessionId, { effort })}
            backend={session.backend}
            {...menuProps("effort")}
          />

          <div className="ml-auto flex items-center gap-1">
            <ContextMeter sessionId={sessionId} />
            <AgentToolbar sessionId={sessionId} />
          </div>
        </div>
      </div>
    </div>
  )
}
