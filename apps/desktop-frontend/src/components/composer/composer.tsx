import { GitMerge } from "lucide-react"
import { useCallback, useLayoutEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { ComposerStatusRow } from "@/components/composer/composer-status-row"
import { ComposerToolbar } from "@/components/composer/composer-toolbar"
import { MessageInput } from "@/components/composer/message-input"
import { useFileDrop } from "@/hooks/use-file-drop"
import { useMentions } from "@/hooks/use-mentions"
import { useUiCommand } from "@/hooks/use-ui-command"
import * as ipc from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"
import type { Attachment } from "@/types"

const MAX_TEXTAREA_HEIGHT = 200

/** The message composer: owns the draft (text + attachments), the toolbar menu
 *  state, and the textarea autosizing, and composes the status row, input card,
 *  and settings toolbar. The pieces are presentational; state stays here. */
export function Composer({ sessionId }: { sessionId: string }) {
  const session = useAppStore((s) => s.sessions[sessionId])
  const sendMessage = useAppStore((s) => s.sendMessage)
  const cancel = useAppStore((s) => s.cancel)
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
        <ComposerStatusRow sessionId={sessionId} />
        <MessageInput
          value={value}
          setValue={setValue}
          mentions={mentions}
          attachments={attachments}
          onRemoveAttachment={(id) =>
            setAttachments((prev) => prev.filter((a) => a.id !== id))
          }
          textareaRef={textareaRef}
          backdropRef={backdropRef}
          running={running}
          canSend={canSend}
          onSubmit={submit}
          onCancel={() => void cancel(sessionId)}
        />
        <ComposerToolbar
          session={session}
          sessionId={sessionId}
          started={started}
          menuProps={menuProps}
        />
      </div>
    </div>
  )
}
