import { useCallback, useEffect, useMemo, useState } from "react"
import { FileDiff, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import * as ipc from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"
import type { DiffResult } from "@/types"

function lineClass(line: string): string {
  if (line.startsWith("@@")) {
    return "text-sky-500"
  }
  if (line.startsWith("+++") || line.startsWith("---")) {
    return "text-muted-foreground"
  }
  if (line.startsWith("+")) {
    return "bg-emerald-500/10 text-emerald-500"
  }
  if (line.startsWith("-")) {
    return "bg-destructive/10 text-destructive"
  }
  if (line.startsWith("diff ") || line.startsWith("index ")) {
    return "text-muted-foreground/70"
  }
  return "text-foreground/80"
}

function UnifiedDiff({ unified }: { unified: string }) {
  const lines = useMemo(() => unified.split("\n"), [unified])
  return (
    <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed">
      {lines.map((line, i) => (
        <div key={i} className={cn("px-3", lineClass(line))}>
          {line === "" ? " " : line}
        </div>
      ))}
    </pre>
  )
}

export function DiffView({ sessionId }: { sessionId: string }) {
  const isIsolated = useAppStore((s) => s.sessions[sessionId]?.isIsolated)
  const events = useAppStore((s) => s.eventsBySession[sessionId])

  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await ipc.getDiff(sessionId)
      setDiff(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Refresh when a result event arrives (the agent finished a turn).
  const lastResultId = useMemo(() => {
    if (!events) return null
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === "result") {
        return events[i].id
      }
    }
    return null
  }, [events])

  useEffect(() => {
    if (lastResultId) {
      void refresh()
    }
  }, [lastResultId, refresh])

  const hasChanges = diff && diff.files.length > 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <FileDiff className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Diff</span>
        {diff?.truncated && (
          <span className="text-xs text-amber-500">truncated</span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Refresh diff"
        >
          <RefreshCw className={cn(loading && "animate-spin")} />
        </Button>
      </div>

      {!isIsolated ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          This session is not isolated, so it has no worktree diff.
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-destructive">
          {error}
        </div>
      ) : !hasChanges ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          {loading ? "Loading diff…" : "No changes yet."}
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-1 p-3 text-xs">
            {diff.files.map((file) => (
              <div
                key={file.path}
                className="flex items-center gap-2 font-mono"
              >
                <span className="truncate" title={file.path}>
                  {file.path}
                </span>
                {file.binary ? (
                  <span className="ml-auto text-muted-foreground">binary</span>
                ) : (
                  <span className="ml-auto flex shrink-0 gap-2">
                    <span className="text-emerald-500">+{file.additions}</span>
                    <span className="text-destructive">-{file.deletions}</span>
                  </span>
                )}
              </div>
            ))}
          </div>
          <Separator />
          <div className="py-2">
            <UnifiedDiff unified={diff.unified} />
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
