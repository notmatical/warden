import { openUrl } from "@tauri-apps/plugin-opener"
import { ListTodo, Loader2, MoreHorizontal, RefreshCw } from "lucide-react"
import { type FormEvent, useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { CountChip } from "@/components/common/count-chip"
import { FILTER_SURFACE } from "@/components/common/filter-menu"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import { useLinearIssues } from "../hooks"
import { linearConnect, linearDisconnect, linearStatus } from "../ipc"
import type { LinearComment, LinearIssue } from "../types"
import { IssueList } from "./issue-list"
import { IssuePeekPanel } from "./issue-peek-panel"
import { SendToAgentDialog } from "./send-to-agent-dialog"

const API_KEYS_URL = "https://linear.app/settings/account/security"

type Phase = "loading" | "disconnected" | "connected"

/** The global Tasks destination, backed by Linear. Issues come from a local
 *  cache (instant/offline) a background poll keeps fresh, grouped by workflow
 *  state and filterable by status/priority/assignee/label, like Linear's list. */
export function LinearTasksView() {
  const [phase, setPhase] = useState<Phase>("loading")
  const { issues, syncing, error, loadCached, syncNow, clear } =
    useLinearIssues()

  const [keyInput, setKeyInput] = useState("")
  const [connecting, setConnecting] = useState(false)

  const [peekId, setPeekId] = useState<string | null>(null)
  const peekIssue = issues.find((i) => i.id === peekId) ?? null

  const [send, setSend] = useState<{
    issue: LinearIssue
    comments: LinearComment[]
  } | null>(null)

  const refresh = useCallback(async () => {
    try {
      const { connected } = await linearStatus()
      if (connected) {
        setPhase("connected")
        await loadCached() // instant from cache
        void syncNow() // then freshen in the background
      } else {
        setPhase("disconnected")
      }
    } catch {
      setPhase("disconnected")
    }
  }, [loadCached, syncNow])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleConnect = async (e: FormEvent) => {
    e.preventDefault()
    const key = keyInput.trim()
    if (!key) return
    setConnecting(true)
    try {
      const viewer = await linearConnect(key)
      setKeyInput("")
      setPhase("connected")
      toast.success(`Connected to Linear as ${viewer.name}`)
      await loadCached()
    } catch (e) {
      toast.error("Couldn't connect to Linear", { description: String(e) })
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    try {
      await linearDisconnect()
      clear()
      setPhase("disconnected")
    } catch (e) {
      toast.error("Couldn't disconnect", { description: String(e) })
    }
  }

  if (phase === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  }

  if (phase === "disconnected") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-muted/50 text-muted-foreground">
          <ListTodo className="size-6" />
        </div>
        <div className="space-y-1">
          <h2 className="font-medium text-foreground text-sm">
            Connect Linear
          </h2>
          <p className="max-w-xs text-muted-foreground text-xs">
            Paste a personal API key to triage and work your Linear issues
            without leaving warden.
          </p>
        </div>
        <form
          onSubmit={handleConnect}
          className="flex w-full max-w-xs flex-col gap-2"
        >
          <Input
            type="password"
            autoComplete="off"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="lin_api_…"
            className="h-8 text-center font-mono text-xs"
          />
          <Button
            type="submit"
            size="sm"
            disabled={connecting || !keyInput.trim()}
          >
            {connecting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              "Connect"
            )}
          </Button>
        </form>
        <button
          type="button"
          onClick={() => void openUrl(API_KEYS_URL)}
          className="text-[11px] text-muted-foreground/70 underline-offset-2 hover:text-muted-foreground hover:underline"
        >
          Create a key in Linear → Settings → Security &amp; access
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 px-6 pb-6">
      <IssueList
        issues={issues}
        syncing={syncing}
        error={error}
        onSelect={(issue) => setPeekId(issue.id)}
        leading={
          <span className="flex items-center gap-2.5">
            <h1 className="font-semibold text-foreground">Issues</h1>
            <CountChip>{issues.length}</CountChip>
          </span>
        }
        trailing={
          <>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Refresh"
              onClick={() => void syncNow()}
              disabled={syncing}
              className={cn(
                "size-8 text-muted-foreground hover:bg-input/70 hover:text-foreground dark:hover:bg-input/70",
                FILTER_SURFACE
              )}
            >
              <RefreshCw
                className={cn("size-3.5", syncing && "animate-spin")}
              />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Linear actions"
                  className={cn(
                    "size-8 text-muted-foreground hover:bg-input/70 hover:text-foreground dark:hover:bg-input/70",
                    FILTER_SURFACE
                  )}
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onSelect={() => void handleDisconnect()}>
                  Disconnect Linear
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <IssuePeekPanel
        open={peekId !== null}
        issue={peekIssue}
        onOpenChange={(open) => {
          if (!open) setPeekId(null)
        }}
        onSendToAgent={(issue, comments) => setSend({ issue, comments })}
      />

      <SendToAgentDialog
        issue={send?.issue ?? null}
        comments={send?.comments ?? []}
        open={send !== null}
        onOpenChange={(open) => {
          if (!open) setSend(null)
        }}
        onSent={() => setPeekId(null)}
      />
    </div>
  )
}
