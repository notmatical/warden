import { useState, type KeyboardEvent } from "react"
import { ChevronDown, Plus, Sparkles, SquareTerminal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { PlanToCodeDialog } from "@/components/plan-to-code-dialog"
import { DEFAULT_CHAT_MODEL, DEFAULT_CODEX_MODEL } from "@/lib/models"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"
import type { Backend, SessionKind } from "@/types"

function deriveTitle(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) {
    return "New session"
  }
  const firstLine = trimmed.split("\n")[0]
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine
}

export function Omnibox() {
  const primaryRootId = useAppStore((s) =>
    s.activeGroupId ? s.rootsByGroup[s.activeGroupId]?.[0]?.id ?? null : null
  )
  const createSession = useAppStore((s) => s.createSession)

  const [value, setValue] = useState("")
  const [creating, setCreating] = useState(false)

  const disabled = !primaryRootId
  const canCreate = !disabled && !creating

  const create = async (kind: SessionKind = "agent", backend?: Backend) => {
    if (!canCreate || !primaryRootId) return
    setCreating(true)
    try {
      const text = value.trim()
      const session = await createSession({
        projectId: primaryRootId,
        title: kind === "terminal" ? "Terminal" : deriveTitle(text),
        model: backend === "codex" ? DEFAULT_CODEX_MODEL : DEFAULT_CHAT_MODEL,
        permissionMode: "bypassPermissions",
        role: "chat",
        kind,
        backend,
        firstMessage: kind === "agent" ? text || undefined : undefined,
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
    <div className="flex items-center gap-2">
      <div
        className={cn(
          "flex h-9 flex-1 items-center gap-1 rounded-lg border border-border/60 bg-card/40 pr-1 pl-3 transition-colors",
          "focus-within:border-border focus-within:bg-card/70",
          disabled && "opacity-60"
        )}
      >
        <Sparkles className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={
            disabled
              ? "Open a folder in this group to start"
              : "Start a session — describe the first task"
          }
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 disabled:cursor-not-allowed"
        />

        <ButtonGroup>
          <Button
            size="sm"
            className="h-7 gap-1.5"
            onClick={() => void create("agent")}
            disabled={!canCreate}
          >
            <Plus className="size-3.5" />
            New session
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-sm"
                disabled={!canCreate}
                aria-label="New session options"
              >
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={() => void create("agent")}>
                <Sparkles />
                Agent session
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => void create("agent", "codex")}
              >
                <Sparkles />
                Codex session
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void create("terminal")}>
                <SquareTerminal />
                Terminal session
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ButtonGroup>
      </div>

      <PlanToCodeDialog disabled={disabled} />
    </div>
  )
}
