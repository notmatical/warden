import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { CornerDownLeft, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { EffortMenu } from "@/components/controls/effort-menu"
import { ModeMenu } from "@/components/controls/mode-menu"
import { ModelMenu } from "@/components/controls/model-menu"
import { MentionPopover } from "@/components/mention-popover"
import { useMentions } from "@/hooks/use-mentions"
import { useAppStore } from "@/store/app-store"

const MAX_TEXTAREA_HEIGHT = 200

export function Composer({ sessionId }: { sessionId: string }) {
  const session = useAppStore((s) => s.sessions[sessionId])
  const sendMessage = useAppStore((s) => s.sendMessage)
  const cancel = useAppStore((s) => s.cancel)
  const updateSession = useAppStore((s) => s.updateSession)
  const [value, setValue] = useState("")
  // Only one toolbar menu open at a time.
  const [openMenu, setOpenMenu] = useState<"model" | "mode" | "effort" | null>(
    null
  )
  const menuProps = (id: "model" | "mode" | "effort") => ({
    open: openMenu === id,
    onOpenChange: (open: boolean) => setOpenMenu(open ? id : null),
  })
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const mentions = useMentions({
    value,
    onChange: setValue,
    textareaRef,
    workingDir: session?.workingDir ?? null,
  })

  // Grow the textarea with its content, from a single line up to a cap.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [value])

  const running = session?.status === "running"
  const canSend = value.trim().length > 0 && !running

  if (!session) {
    return null
  }

  const submit = () => {
    if (!canSend) return
    const text = value.trim()
    setValue("")
    void sendMessage(sessionId, text)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-3 pb-3">
      <div className="flex flex-col">
        {/* Input card — single, solid surface, on top. Send/stop lives inline
            on the right as a ghost icon. */}
        <div className="relative z-10 flex items-end gap-1 rounded-xl border border-border/60 bg-card pr-1.5 transition-colors focus-within:border-border/80">
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
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              mentions.handleInput(e.target.value, e.target.selectionStart ?? 0)
            }}
            onKeyDown={(e) => {
              if (mentions.handleKeyDown(e)) return
              handleKeyDown(e)
            }}
            disabled={running}
            rows={1}
            placeholder={
              running
                ? "Agent is working…"
                : "Message the agent…  (Enter to send)"
            }
            className="block max-h-[200px] min-w-0 flex-1 resize-none bg-transparent py-3 pr-1 pl-3.5 text-sm outline-none placeholder:text-muted-foreground/60 disabled:opacity-60"
          />
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

        {/* Attached settings panel — tucked behind the card, tinted. */}
        <div className="-mt-3 flex items-center gap-1 rounded-b-xl bg-muted/40 px-2 pt-5 pb-1.5">
          <ModelMenu
            value={session.model}
            onChange={(model) => void updateSession(sessionId, { model })}
            {...menuProps("model")}
          />
          <div className="mx-0.5 h-4 w-px bg-border/60" />
          <ModeMenu
            value={session.permissionMode}
            onChange={(permissionMode) =>
              void updateSession(sessionId, { permissionMode })
            }
            {...menuProps("mode")}
          />
          <EffortMenu
            value={session.effort}
            onChange={(effort) => void updateSession(sessionId, { effort })}
            {...menuProps("effort")}
          />
        </div>
      </div>
    </div>
  )
}
