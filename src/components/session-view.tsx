import { GitBranch, Link2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Composer } from "@/components/composer"
import { StatusDot } from "@/components/status-dot"
import { Transcript } from "@/components/transcript"
import { formatCost } from "@/lib/format"
import { useAppStore } from "@/store/app-store"

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

  if (!session) {
    return null
  }

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
          <span>{session.turns} turns</span>
          <span>{formatCost(session.costUsd)}</span>
          <PartnerLink sessionId={sessionId} />
        </div>
      </header>

      {/* Chat region: the transcript fills the space and scrolls *under* the
          floating composer, which fades in over a gradient (no hard footer). */}
      <div className="relative min-h-0 flex-1">
        <Transcript sessionId={sessionId} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0">
          <div className="h-12 bg-gradient-to-t from-background to-transparent" />
          <div className="pointer-events-auto bg-background">
            <Composer sessionId={sessionId} />
          </div>
        </div>
      </div>
    </div>
  )
}
