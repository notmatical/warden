import { openUrl } from "@tauri-apps/plugin-opener"
import {
  ExternalLink,
  ListTodo,
  Loader2,
  MoreHorizontal,
  RefreshCw,
} from "lucide-react"
import { type FormEvent, useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import {
  DataTable,
  DataTableEmpty,
  DataTableRow,
  DataTableSkeleton,
} from "@/components/common/data-table"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { relativeTime } from "@/lib/time"
import { cn } from "@/lib/utils"

import {
  linearConnect,
  linearDisconnect,
  linearListIssues,
  linearStatus,
} from "../ipc"
import type { LinearIssue } from "../types"

const API_KEYS_URL = "https://linear.app/settings/account/security"

// Identifier · Title (+ state) · Assignee · Updated.
const COLS =
  "grid grid-cols-[minmax(0,84px)_minmax(0,1fr)_minmax(0,140px)_84px] items-center gap-x-3"

const PRIORITY: Record<number, { label: string; cls: string } | undefined> = {
  1: { label: "Urgent", cls: "text-red-400" },
  2: { label: "High", cls: "text-orange-400" },
}

type Phase = "loading" | "disconnected" | "connected"

/** The global Tasks destination, backed by Linear. v1: connect with a personal
 *  API key, then list the viewer's assigned issues (fetched live on open and on
 *  manual refresh; background sync + caching land in a later batch). */
export function LinearTasksView() {
  const [phase, setPhase] = useState<Phase>("loading")
  const [issues, setIssues] = useState<LinearIssue[]>([])
  const [issuesLoading, setIssuesLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [keyInput, setKeyInput] = useState("")
  const [connecting, setConnecting] = useState(false)

  const loadIssues = useCallback(async () => {
    setIssuesLoading(true)
    setError(null)
    try {
      setIssues(await linearListIssues())
    } catch (e) {
      setError(String(e))
    } finally {
      setIssuesLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const { connected } = await linearStatus()
      if (connected) {
        setPhase("connected")
        await loadIssues()
      } else {
        setPhase("disconnected")
      }
    } catch (e) {
      setPhase("disconnected")
      setError(String(e))
    }
  }, [loadIssues])

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
      await loadIssues()
    } catch (e) {
      toast.error("Couldn't connect to Linear", { description: String(e) })
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    try {
      await linearDisconnect()
      setIssues([])
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
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex shrink-0 items-center gap-2.5">
        <ListTodo className="size-4 shrink-0 text-muted-foreground" />
        <h1 className="font-medium text-foreground">Tasks</h1>
        <span className="ml-1 shrink-0 text-muted-foreground text-xs">
          {issues.length} assigned
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh"
            onClick={() => void loadIssues()}
            disabled={issuesLoading}
            className="text-muted-foreground hover:text-foreground"
          >
            <RefreshCw
              className={cn("size-3.5", issuesLoading && "animate-spin")}
            />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Linear actions"
                className="text-muted-foreground hover:text-foreground"
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
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <DataTable>
          {issuesLoading && issues.length === 0 ? (
            <DataTableSkeleton />
          ) : error ? (
            <DataTableEmpty>{error}</DataTableEmpty>
          ) : issues.length === 0 ? (
            <DataTableEmpty>No issues assigned to you.</DataTableEmpty>
          ) : (
            issues.map((issue) => {
              const priority = PRIORITY[issue.priority]
              return (
                <DataTableRow
                  key={issue.id}
                  className={COLS}
                  onClick={() => void openUrl(issue.url)}
                >
                  <span className="truncate font-mono text-[11px] text-muted-foreground tabular-nums">
                    {issue.identifier}
                  </span>

                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: issue.state.color }}
                      title={issue.state.name}
                    />
                    <span className="truncate text-[13px] text-foreground">
                      {issue.title}
                    </span>
                    {priority ? (
                      <span
                        className={cn(
                          "shrink-0 font-medium text-[10px] uppercase tracking-wide",
                          priority.cls
                        )}
                      >
                        {priority.label}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
                    {issue.assignee ? (
                      <>
                        <Avatar user={issue.assignee} />
                        <span className="truncate">{issue.assignee.name}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground/40">
                        Unassigned
                      </span>
                    )}
                  </div>

                  <span className="flex items-center justify-end gap-1 text-muted-foreground text-xs tabular-nums">
                    {relativeTime(issue.updatedAt)}
                    <ExternalLink className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
                  </span>
                </DataTableRow>
              )
            })
          )}
        </DataTable>
      </div>
    </div>
  )
}

function Avatar({
  user,
}: {
  user: { name: string; avatarUrl: string | null }
}) {
  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt=""
        className="size-4 shrink-0 rounded-full"
      />
    )
  }
  const initial = user.name.trim().charAt(0).toUpperCase() || "?"
  return (
    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] text-muted-foreground">
      {initial}
    </span>
  )
}
