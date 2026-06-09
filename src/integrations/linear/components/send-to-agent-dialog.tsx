import { Loader2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { ModeMenu } from "@/components/controls/mode-menu"
import { ModelMenu } from "@/components/controls/model-menu"
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { DEFAULT_CHAT_MODEL, backendForModel } from "@/lib/models"
import { useAppStore } from "@/store/app-store"
import type { PermissionMode, Project } from "@/types"

import type { LinearComment, LinearIssue } from "../types"
import { buildIssuePrompt } from "../prompt"

/** Spawn a chat session seeded with the full issue as its first message.
 *  Repo, model, permission mode, and worktree isolation are picked here;
 *  everything downstream is the ordinary session flow. */
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

  const projects = useMemo<Project[]>(() => {
    const byId = new Map<string, Project>()
    for (const roots of Object.values(rootsByGroup))
      for (const p of roots) if (!byId.has(p.id)) byId.set(p.id, p)
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [rootsByGroup])

  const [projectId, setProjectId] = useState<string>("")
  const [model, setModel] = useState(DEFAULT_CHAT_MODEL)
  const [mode, setMode] = useState<PermissionMode>("bypassPermissions")
  const [isolate, setIsolate] = useState(false)
  const [creating, setCreating] = useState(false)

  // Re-seed the repo selection each time the dialog opens.
  useEffect(() => {
    if (!open) return
    setProjectId(defaultProjectId ?? projects[0]?.id ?? "")
  }, [open, defaultProjectId, projects])

  if (!issue) return null

  const handleSend = async () => {
    if (!projectId) return
    setCreating(true)
    try {
      const session = await createSession({
        projectId,
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
            <span className="text-muted-foreground text-xs">Repository</span>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick a repository" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">Model</span>
              <ModelMenu
                value={model}
                onChange={setModel}
                backend={backendForModel(model)}
                started={false}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">Mode</span>
              <ModeMenu value={mode} onChange={setMode} />
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
            disabled={!projectId || creating}
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
