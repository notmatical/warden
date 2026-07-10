import { Button } from "@warden/ui/components/button"
import { CornerDownLeft, Square } from "lucide-react"
import type { KeyboardEvent, RefObject } from "react"
import { AttachmentRow } from "@/components/attachment-row"
import { MentionHighlight } from "@/components/mention-highlight"
import { MentionPopover } from "@/components/mention-popover"
import type { UseMentionsResult } from "@/hooks/use-mentions"
import { cn } from "@/lib/utils"
import type { Attachment } from "@/types"

// Shared box + typography + wrapping so the backdrop and textarea lay text out
// identically (any divergence shifts the caret off the highlighted token).
const INPUT_BOX =
  "py-3 pr-1 pl-3.5 text-sm leading-5 tracking-normal break-words whitespace-pre-wrap"

interface MessageInputProps {
  value: string
  setValue: (value: string) => void
  mentions: UseMentionsResult
  attachments: Attachment[]
  onRemoveAttachment: (id: string) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
  backdropRef: RefObject<HTMLDivElement | null>
  running: boolean
  canSend: boolean
  onSubmit: () => void
  onCancel: () => void
}

/** The input card: the @-mention popover, attachment row, the highlight-backdrop
 *  textarea, and the inline send/stop button. */
export function MessageInput({
  value,
  setValue,
  mentions,
  attachments,
  onRemoveAttachment,
  textareaRef,
  backdropRef,
  running,
  canSend,
  onSubmit,
  onCancel,
}: MessageInputProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentions.handleKeyDown(event)) return
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      onSubmit()
    }
  }

  return (
    // Input card — solid surface. Attachments stack inside, above the textarea;
    // send/stop lives inline on the right.
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
      <AttachmentRow items={attachments} onRemove={onRemoveAttachment} />
      {/* Textarea + send/stop, laid out as a row. */}
      <div className="flex items-end gap-1 pr-1.5">
        {/* Highlight backdrop + transparent textarea: mention tokens are colored
            on the backdrop and show through the textarea. */}
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
              mentions.handleInput(e.target.value, e.target.selectionStart ?? 0)
            }}
            onKeyDown={handleKeyDown}
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
            onClick={onCancel}
            aria-label="Stop the agent"
            className="mb-1.5 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <Square />
          </Button>
        ) : (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onSubmit}
            disabled={!canSend}
            aria-label="Send message"
            className="mb-1.5 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <CornerDownLeft />
          </Button>
        )}
      </div>
    </div>
  )
}
