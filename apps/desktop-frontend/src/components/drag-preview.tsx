import { SessionFavicon } from "@/components/session-favicon"
import { describe } from "@/lib/viewport/content-registry"
import { useAppStore } from "@/store/app-store"

/** The floating clone under the cursor while a tab is dragged — a "lifted"
 *  tab pill (favicon + title, elevated shadow) that stands in for the hidden
 *  original, for session and static tabs alike. */
export function DragPreview({ sessionId }: { sessionId: string }) {
  const d = describe(sessionId)
  const Icon = d.icon
  const title = useAppStore((s) => d.title(s, sessionId)) ?? ""
  const session = useAppStore((s) => s.sessions[sessionId])

  return (
    <div className="flex h-9 max-w-64 cursor-grabbing items-center gap-2 rounded-lg border border-border/60 bg-background px-3 text-[13px] text-foreground shadow-xl">
      {d.kind === "session" && session ? (
        <SessionFavicon
          kind={session.kind}
          backend={session.backend}
          status={session.status}
          terminalCommand={session.terminalCommand}
          className="size-[18px]"
        />
      ) : (
        <Icon className="size-[18px] shrink-0 text-muted-foreground" />
      )}
      <span className="truncate">{title}</span>
    </div>
  )
}
