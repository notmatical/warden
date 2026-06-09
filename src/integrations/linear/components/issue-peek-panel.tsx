import { openUrl } from "@tauri-apps/plugin-opener"
import { ExternalLink, Loader2, Send } from "lucide-react"
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"

import { Button } from "@/components/ui/button"
import { Markdown } from "@/components/ui/markdown"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"

import { linearIssueComments } from "../ipc"
import type { LinearComment, LinearIssue } from "../types"
import { PriorityIcon, StatusIcon } from "./issue-icons"
import { Avatar, formatDate } from "./issue-list"

export const PRIORITY_LABELS: Record<number, string> = {
  0: "No priority",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
}

type CommentsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; comments: LinearComment[] }

/** Linear-style slide-over rendering a cached issue like its task page:
 *  metadata, markdown description, and live-fetched comments. `issue` is the
 *  live cache lookup; a snapshot keeps the panel rendering if a background
 *  sync drops the issue while open. */
export function IssuePeekPanel({
  open,
  issue,
  onOpenChange,
  onSendToAgent,
}: {
  open: boolean
  issue: LinearIssue | null
  onOpenChange: (open: boolean) => void
  onSendToAgent?: (issue: LinearIssue, comments: LinearComment[]) => void
}) {
  const snapshot = useRef<LinearIssue | null>(null)
  if (issue) snapshot.current = issue
  const shown = issue ?? snapshot.current

  const [comments, setComments] = useState<CommentsState>({
    status: "loading",
  })

  // Latest-request-wins guard: a slow fetch for a previous issue (or a stale
  // retry) must not overwrite the current issue's comments.
  const reqRef = useRef(0)
  const loadComments = useCallback((issueId: string) => {
    const req = ++reqRef.current
    setComments({ status: "loading" })
    linearIssueComments(issueId)
      .then((list) => {
        if (reqRef.current === req)
          setComments({ status: "loaded", comments: list })
      })
      .catch((e) => {
        if (reqRef.current === req)
          setComments({ status: "error", message: String(e) })
      })
  }, [])

  const shownId = open ? shown?.id : undefined
  useEffect(() => {
    if (shownId) loadComments(shownId)
  }, [shownId, loadComments])

  if (!shown) return null

  const loadedComments =
    comments.status === "loaded" ? comments.comments : []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="gap-0 data-[side=right]:sm:max-w-xl"
      >
        <div className="flex items-center gap-2 border-b py-3 pr-14 pl-4">
          <span className="font-mono text-muted-foreground text-xs tabular-nums">
            {shown.identifier}
          </span>
          <div className="flex-1" />
          {onSendToAgent ? (
            <Button
              variant="secondary"
              size="sm"
              className="h-7 gap-1.5"
              onClick={() => onSendToAgent(shown, loadedComments)}
            >
              <Send className="size-3.5" />
              Send to Agent
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open in Linear"
            onClick={() => void openUrl(shown.url)}
            className="text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-4 p-4">
            <SheetTitle className="text-lg leading-snug">
              {shown.title}
            </SheetTitle>

            <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-[13px]">
              <PropertyLabel>Status</PropertyLabel>
              <span className="flex items-center gap-1.5">
                <StatusIcon
                  type={shown.state.type}
                  color={shown.state.color}
                  className="size-3.5"
                />
                {shown.state.name}
              </span>

              <PropertyLabel>Priority</PropertyLabel>
              <span className="flex items-center gap-1.5">
                <PriorityIcon
                  priority={shown.priority}
                  className="size-3.5 text-muted-foreground"
                />
                {PRIORITY_LABELS[shown.priority] ?? "No priority"}
              </span>

              <PropertyLabel>Assignee</PropertyLabel>
              {shown.assignee ? (
                <span className="flex items-center gap-1.5">
                  <Avatar user={shown.assignee} />
                  {shown.assignee.name}
                </span>
              ) : (
                <span className="text-muted-foreground">Unassigned</span>
              )}

              <PropertyLabel>Team</PropertyLabel>
              <span>
                <span className="font-mono text-muted-foreground text-xs">
                  {shown.team.key}
                </span>{" "}
                {shown.team.name}
              </span>

              {shown.project ? (
                <>
                  <PropertyLabel>Project</PropertyLabel>
                  <span>{shown.project.name}</span>
                </>
              ) : null}

              {shown.labels.length > 0 ? (
                <>
                  <PropertyLabel>Labels</PropertyLabel>
                  <span className="flex flex-wrap items-center gap-1">
                    {shown.labels.map((label) => (
                      <span
                        key={label}
                        className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {label}
                      </span>
                    ))}
                  </span>
                </>
              ) : null}
            </div>

            <div className="border-t pt-4">
              {shown.description?.trim() ? (
                <Markdown className="text-sm">{shown.description}</Markdown>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No description.
                </p>
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
                    onClick={() => loadComments(shown.id)}
                  >
                    Retry
                  </Button>
                </div>
              ) : comments.comments.length === 0 ? (
                <p className="text-muted-foreground text-sm">No comments.</p>
              ) : (
                <div className="flex flex-col gap-4">
                  {comments.comments.map((c) => (
                    <div key={c.id} className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <Avatar
                          user={c.user ?? { name: "?", avatarUrl: null }}
                        />
                        <span className="font-medium text-foreground text-xs">
                          {c.user?.name ?? "Unknown"}
                        </span>
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {formatDate(c.createdAt)}
                        </span>
                      </div>
                      <div className="pl-7">
                        <Markdown className="text-sm">{c.body}</Markdown>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function PropertyLabel({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>
}
