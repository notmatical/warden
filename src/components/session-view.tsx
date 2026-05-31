import { GitBranch, Link2, Square } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { Composer } from "@/components/composer"
import { DiffView } from "@/components/diff-view"
import { StatusDot } from "@/components/status-dot"
import { Transcript } from "@/components/transcript"
import { formatCost, shortModel } from "@/lib/format"
import { useAppStore } from "@/store/app-store"
import type { PermissionMode } from "@/types"

const PERMISSION_LABEL: Record<PermissionMode, string> = {
  acceptEdits: "Accept edits",
  bypassPermissions: "Bypass",
  plan: "Plan",
  default: "Default",
}

function PartnerLink({ sessionId }: { sessionId: string }) {
  const session = useAppStore((s) => s.sessions[sessionId])
  const sessions = useAppStore((s) => s.sessions)
  const selectSession = useAppStore((s) => s.selectSession)

  if (!session || session.role === "chat") {
    return null
  }

  const partner = Object.values(sessions).find((other) => {
    if (other.id === session.id) return false
    return other.id === session.parentId || other.parentId === session.id
  })

  if (!partner) {
    return null
  }

  const partnerKind = partner.role === "planner" ? "planner" : "coder"

  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={() => selectSession(partner.id)}
      title={`Go to ${partnerKind}: ${partner.title}`}
    >
      <Link2 />
      {partnerKind}
    </Button>
  )
}

export function SessionView({ sessionId }: { sessionId: string }) {
  const session = useAppStore((s) => s.sessions[sessionId])
  const cancel = useAppStore((s) => s.cancel)

  if (!session) {
    return null
  }

  const running = session.status === "running"

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <StatusDot status={session.status} />
        <h1 className="truncate text-sm font-medium" title={session.title}>
          {session.title}
        </h1>
        {session.role !== "chat" && (
          <Badge variant="secondary" className="capitalize">
            {session.role}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {session.branch && (
            <span className="flex items-center gap-1" title={session.branch}>
              <GitBranch className="size-3.5" />
              <span className="max-w-32 truncate">{session.branch}</span>
            </span>
          )}
          <span>{shortModel(session.model)}</span>
          <span>{PERMISSION_LABEL[session.permissionMode]}</span>
          <span>{session.turns} turns</span>
          <span>{formatCost(session.costUsd)}</span>
          <PartnerLink sessionId={sessionId} />
          {running && (
            <Button
              variant="destructive"
              size="xs"
              onClick={() => void cancel(sessionId)}
            >
              <Square />
              Cancel
            </Button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize={55} minSize={30}>
            <Transcript sessionId={sessionId} />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={45} minSize={25}>
            <DiffView sessionId={sessionId} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <Composer sessionId={sessionId} />
    </div>
  )
}
