import { useState, type KeyboardEvent } from "react"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PlanToCodeDialog } from "@/components/plan-to-code-dialog"
import { DEFAULT_CHAT_MODEL, MODELS } from "@/lib/models"
import { useAppStore } from "@/store/app-store"

function deriveTitle(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) {
    return "New session"
  }
  const firstLine = trimmed.split("\n")[0]
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine
}

export function Omnibox() {
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const createSession = useAppStore((s) => s.createSession)

  const [value, setValue] = useState("")
  const [model, setModel] = useState(DEFAULT_CHAT_MODEL)
  const [creating, setCreating] = useState(false)

  const disabled = !activeWorkspaceId
  const canCreate = !disabled && !creating

  const create = async () => {
    if (!canCreate) return
    setCreating(true)
    try {
      const text = value.trim()
      const session = await createSession({
        title: deriveTitle(text),
        model,
        permissionMode: "default",
        role: "chat",
        firstMessage: text || undefined,
      })
      if (session) {
        setValue("")
      }
    } finally {
      setCreating(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      void create()
    }
  }

  return (
    <div className="flex flex-1 items-center gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={
          disabled
            ? "Open a workspace to start a session"
            : "Start a session… describe the first task"
        }
        className="flex-1"
      />
      <Select value={model} onValueChange={setModel} disabled={disabled}>
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MODELS.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button onClick={() => void create()} disabled={!canCreate}>
        <Plus />
        New session
      </Button>
      <PlanToCodeDialog disabled={disabled} />
    </div>
  )
}
