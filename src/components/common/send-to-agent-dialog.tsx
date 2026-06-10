import { Loader2 } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"

import {
  FolderPicker,
  type FolderRef,
} from "@/components/controls/folder-picker"
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
import { Switch } from "@/components/ui/switch"
import { backendForModel, DEFAULT_CHAT_MODEL } from "@/lib/models"
import { useAppStore } from "@/store/app-store"
import type { CreateSessionOptions } from "@/store/types"
import type { PermissionMode, Session } from "@/types"

/** The shared "send something to an agent" dialog: pick a (group, folder)
 *  pair, model, permission mode, and worktree isolation, then spawn a chat
 *  session seeded with a first message. Integrations wrap this with their own
 *  prompt building, folder preselection, and extra toggles (`children`). */
export function SendToAgentDialogCore({
  identifier,
  open,
  onOpenChange,
  buildTitle,
  buildFirstMessage,
  preselectProjectId,
  defaultProjectId,
  createOverrides,
  children,
  onSent,
}: {
  /** Short display id of the thing being sent (e.g. "WAR-12", "#42"). */
  identifier: string
  open: boolean
  onOpenChange: (open: boolean) => void
  buildTitle: () => string
  buildFirstMessage: () => string
  /** Async best-effort folder preselection when no explicit default is set. */
  preselectProjectId?: () => Promise<string | null>
  defaultProjectId?: string
  /** Extra session options spread over the core's (e.g. linearIssueId). */
  createOverrides?: Partial<CreateSessionOptions>
  /** Extra form rows rendered under the isolate toggle. */
  children?: ReactNode
  onSent?: (session: Session) => void
}) {
  const rootsByGroup = useAppStore((s) => s.rootsByGroup)
  const createSession = useAppStore((s) => s.createSession)

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

  const preselectRef = useRef(preselectProjectId)
  preselectRef.current = preselectProjectId

  // Re-seed the folder each time the dialog opens for a new subject.
  const seedKey = open ? identifier : undefined
  useEffect(() => {
    if (seedKey === undefined) return
    setFolder(
      (defaultProjectId ? folderRefFor(defaultProjectId) : null) ?? firstFolder
    )
    if (defaultProjectId || !preselectRef.current) return

    let stale = false
    void preselectRef
      .current()
      .then((projectId) => {
        if (stale || !projectId) return
        const ref = folderRefFor(projectId)
        if (ref) setFolder(ref)
      })
      .catch(() => {}) // preselection is best-effort
    return () => {
      stale = true
    }
  }, [seedKey, defaultProjectId, folderRefFor, firstFolder])

  const handleSend = async () => {
    if (!folder) return
    setCreating(true)
    try {
      const session = await createSession({
        projectId: folder.projectId,
        groupId: folder.groupId,
        title: buildTitle(),
        model,
        permissionMode: mode,
        backend: backendForModel(model),
        role: "chat",
        isolate,
        firstMessage: buildFirstMessage(),
        ...createOverrides,
      })
      if (session) {
        onOpenChange(false)
        onSent?.(session)
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
            <span className="font-mono text-xs">{identifier}</span> with the
            full task as the first message.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs">
              Working directory
            </span>
            <FolderPicker value={folder} onChange={setFolder} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">Model</span>
              <ModelMenu
                variant="form"
                value={model}
                onChange={setModel}
                backend={backendForModel(model)}
                started={false}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">Mode</span>
              <ModeMenu variant="form" value={mode} onChange={setMode} />
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

          {children}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
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
