import { Loader2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { FolderPicker, type FolderRef } from "@/components/controls/folder-picker"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  DEFAULT_CHAT_MODEL,
  MODEL_PROVIDERS,
  MODELS,
  backendForModel,
} from "@/lib/models"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"
import type { PermissionMode } from "@/types"

import { linearBindings } from "../ipc"
import { buildIssuePrompt } from "../prompt"
import type { LinearComment, LinearIssue } from "../types"

const MODES: { value: PermissionMode; label: string; dot: string }[] = [
  { value: "plan", label: "Plan", dot: "bg-amber-500" },
  { value: "acceptEdits", label: "Accept edits", dot: "bg-emerald-500" },
  { value: "bypassPermissions", label: "Bypass permissions", dot: "bg-red-500" },
]

/** Spawn a chat session seeded with the full issue as its first message.
 *  Folder (group-qualified), model, permission mode, and worktree isolation
 *  are picked here; everything downstream is the ordinary session flow. */
export function SendToAgentDialog({
  issue,
  comments,
  open,
  onOpenChange,
  defaultProjectId,
  onSent,
}: {
  issue: LinearIssue | null
  comments: LinearComment[]
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultProjectId?: string
  onSent?: () => void
}) {
  const rootsByGroup = useAppStore((s) => s.rootsByGroup)
  const createSession = useAppStore((s) => s.createSession)
  const providers = useAppStore((s) => s.providers)
  const authedBackends = useMemo(
    () => new Set(providers.filter((p) => p.authed).map((p) => p.id)),
    [providers]
  )

  // First group that contains a root — the picker default; users with the same
  // folder in several groups can re-pick the exact pair.
  const folderRefFor = useMemo(
    () =>
      (projectId: string): FolderRef | null => {
        const hit = Object.entries(rootsByGroup).find(([, roots]) =>
          roots.some((root) => root.id === projectId)
        )
        return hit ? { groupId: hit[0], projectId } : null
      },
    [rootsByGroup]
  )

  const firstFolder = useMemo<FolderRef | null>(() => {
    for (const [groupId, roots] of Object.entries(rootsByGroup))
      if (roots.length > 0) return { groupId, projectId: roots[0].id }
    return null
  }, [rootsByGroup])

  const [folder, setFolder] = useState<FolderRef | null>(null)
  const [model, setModel] = useState(DEFAULT_CHAT_MODEL)
  const [mode, setMode] = useState<PermissionMode>("bypassPermissions")
  const [isolate, setIsolate] = useState(false)
  const [creating, setCreating] = useState(false)

  const issueRef = useRef(issue)
  issueRef.current = issue

  // Re-seed the folder each time the dialog opens. Without an explicit
  // default, prefer a repo bound to the issue's project, then its team.
  const issueId = open ? issue?.id : undefined
  useEffect(() => {
    if (!issueId) return
    setFolder(
      (defaultProjectId ? folderRefFor(defaultProjectId) : null) ?? firstFolder
    )
    if (defaultProjectId) return

    let stale = false
    void linearBindings()
      .then((bound) => {
        if (stale) return
        const target = issueRef.current
        if (!target || target.id !== issueId) return
        const match =
          bound.find(
            (b) =>
              folderRefFor(b.projectId) &&
              b.binding.projectId != null &&
              b.binding.projectId === target.project?.id
          ) ??
          bound.find(
            (b) =>
              folderRefFor(b.projectId) && b.binding.teamId === target.team.id
          )
        if (match) setFolder(folderRefFor(match.projectId))
      })
      .catch(() => {}) // preselection is best-effort
    return () => {
      stale = true
    }
  }, [issueId, defaultProjectId, folderRefFor, firstFolder])

  if (!issue) return null

  const handleSend = async () => {
    if (!folder) return
    setCreating(true)
    try {
      const session = await createSession({
        projectId: folder.projectId,
        groupId: folder.groupId,
        title: `${issue.identifier}: ${issue.title}`,
        model,
        permissionMode: mode,
        backend: backendForModel(model),
        role: "chat",
        isolate,
        firstMessage: buildIssuePrompt(issue, comments),
      })
      if (session) {
        onOpenChange(false)
        onSent?.()
      }
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send to Agent</DialogTitle>
          <DialogDescription>
            Start a session on{" "}
            <span className="font-mono text-xs">{issue.identifier}</span> with
            the full issue as the first message.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs">Folder</span>
            <FolderPicker value={folder} onChange={setFolder} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">Model</span>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_PROVIDERS.map((provider) => (
                    <SelectGroup key={provider}>
                      <SelectLabel>{provider}</SelectLabel>
                      {MODELS.filter((m) => m.provider === provider).map(
                        (m) => (
                          <SelectItem
                            key={m.id}
                            value={m.id}
                            disabled={!authedBackends.has(backendForModel(m.id))}
                          >
                            {m.label}
                          </SelectItem>
                        )
                      )}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">Mode</span>
              <Select
                value={mode}
                onValueChange={(v) => setMode(v as PermissionMode)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      <span className="flex items-center gap-2">
                        <span
                          className={cn("size-1.5 rounded-full", m.dot)}
                        />
                        {m.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <label htmlFor="send-isolate" className="flex flex-col">
              <span className="text-sm">Isolate in worktree</span>
              <span className="text-muted-foreground text-xs">
                Work on a separate branch, merge when done.
              </span>
            </label>
            <Switch
              id="send-isolate"
              checked={isolate}
              onCheckedChange={setIsolate}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!folder || creating}
            onClick={() => void handleSend()}
          >
            {creating ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Start session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
