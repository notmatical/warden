import { openUrl } from "@tauri-apps/plugin-opener"
import { ExternalLink, Loader2, Send, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Markdown } from "@/components/ui/markdown"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet"
import { formatDate } from "@/lib/time"

import { githubIssueComments } from "../ipc"
import type { GhIssueComment, RepoIssue } from "../types"

type CommentsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; comments: GhIssueComment[] }

/** Slide-over detail for a GitHub issue: markdown body plus live-fetched
 *  comments — the GitHub counterpart of the Linear peek panel. */
export function GithubIssuePeek({
  open,
  issue,
  onOpenChange,
  onSendToAgent,
}: {
  open: boolean
  issue: RepoIssue | null
  onOpenChange: (open: boolean) => void
  onSendToAgent?: (issue: RepoIssue, comments: GhIssueComment[]) => void
}) {
  const snapshot = useRef<RepoIssue | null>(null)
  if (issue) snapshot.current = issue
  const shown = issue ?? snapshot.current

  const [comments, setComments] = useState<CommentsState>({
    status: "loading",
  })

  // Latest-request-wins guard: a slow fetch for a previous issue (or a stale
  // retry) must not overwrite the current issue's comments.
  const reqRef = useRef(0)
  const loadComments = useCallback((projectId: string, number: number) => {
    const req = ++reqRef.current
    setComments({ status: "loading" })
    githubIssueComments(projectId, number)
      .then((list) => {
        if (reqRef.current === req)
          setComments({ status: "loaded", comments: list })
      })
      .catch((e) => {
        if (reqRef.current === req)
          setComments({ status: "error", message: String(e) })
      })
  }, [])

  const shownKey = open && shown ? `${shown.projectId}:${shown.number}` : null
  useEffect(() => {
    if (!shownKey) return
    const sep = shownKey.lastIndexOf(":")
    loadComments(shownKey.slice(0, sep), Number(shownKey.slice(sep + 1)))
  }, [shownKey, loadComments])

  if (!shown) return null

  const loadedComments = comments.status === "loaded" ? comments.comments : []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="gap-0 data-[side=right]:sm:max-w-xl"
      >
        <div className="flex h-12 items-center gap-1.5 border-b px-4">
          <span className="font-mono text-muted-foreground text-xs tabular-nums">
            {shown.projectName} #{shown.number}
          </span>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open on GitHub"
            onClick={() => void openUrl(shown.url)}
            className="text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
          </Button>
          <SheetClose asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </Button>
          </SheetClose>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-4 p-4">
            <SheetTitle className="text-lg leading-snug">
              {shown.title}
            </SheetTitle>

            <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
              <span>by {shown.author}</span>
              {shown.labels.map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-border/60 px-2 py-0.5 text-[11px]"
                >
                  {label}
                </span>
              ))}
            </div>

            <div className="border-t pt-4">
              {shown.body.trim() ? (
                <Markdown className="text-sm">{shown.body}</Markdown>
              ) : (
                <p className="text-muted-foreground text-sm">No description.</p>
              )}
            </div>

            <div className="border-t pt-4">
              <h3 className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Comments
              </h3>
              {comments.status === "loading" ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="size-3.5 animate-spin" />
                  Loading comments…
                </div>
              ) : comments.status === "error" ? (
                <div className="flex flex-col items-start gap-2">
                  <p className="text-muted-foreground text-sm">
                    Couldn't load comments: {comments.message}
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-7"
                    onClick={() => loadComments(shown.projectId, shown.number)}
                  >
                    Retry
                  </Button>
                </div>
              ) : comments.comments.length === 0 ? (
                <p className="text-muted-foreground text-sm">No comments.</p>
              ) : (
                <div className="flex flex-col gap-4">
                  {comments.comments.map((c) => (
                    <div
                      key={`${c.author}-${c.createdAt}`}
                      className="flex flex-col gap-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground text-xs">
                          {c.author}
                        </span>
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {formatDate(c.createdAt)}
                        </span>
                      </div>
                      <Markdown className="text-sm">{c.body}</Markdown>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {onSendToAgent ? (
          <div className="shrink-0 border-t p-3">
            <Button
              className="w-full gap-1.5"
              onClick={() => onSendToAgent(shown, loadedComments)}
            >
              <Send className="size-3.5" />
              Send to Agent
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
