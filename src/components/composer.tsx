import { useState, type KeyboardEvent } from "react"
import { SendHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useAppStore } from "@/store/app-store"

export function Composer({ sessionId }: { sessionId: string }) {
  const status = useAppStore((s) => s.sessions[sessionId]?.status)
  const sendMessage = useAppStore((s) => s.sendMessage)
  const [value, setValue] = useState("")

  const running = status === "running"
  const canSend = value.trim().length > 0 && !running

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
    <div className="flex items-end gap-2 border-t border-border p-3">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={running}
        rows={2}
        placeholder={
          running ? "Agent is working…" : "Message the agent… (Enter to send)"
        }
        className="max-h-40 min-h-[2.5rem] flex-1 resize-none"
      />
      <Button
        onClick={submit}
        disabled={!canSend}
        size="icon-lg"
        aria-label="Send message"
      >
        <SendHorizontal />
      </Button>
    </div>
  )
}
