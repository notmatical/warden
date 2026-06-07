import { useEffect, useRef, useState } from "react"

import { Composer } from "@/components/composer"
import { TerminalView } from "@/components/terminal-view"
import { Transcript } from "@/components/transcript"
import { EdgeFade } from "@/components/ui/edge-fade"
import { useAppStore } from "@/store/app-store"

/** Agent transcript + floating composer. The transcript scrolls *under* the
 *  composer (which fades in over a gradient); its bottom padding tracks the
 *  composer's measured height so the last message + its footer always clear it. */
function AgentView({ sessionId }: { sessionId: string }) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [inset, setInset] = useState(220)

  useEffect(() => {
    const el = overlayRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setInset(el.offsetHeight + 4))
    observer.observe(el)
    setInset(el.offsetHeight + 4)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="relative h-full">
      <Transcript sessionId={sessionId} bottomInset={inset} />
      <EdgeFade edge="top" />
      <div
        ref={overlayRef}
        className="pointer-events-none absolute inset-x-0 bottom-0"
      >
        <EdgeFade edge="bottom" className="static" />
        <div className="pointer-events-auto bg-background">
          <Composer sessionId={sessionId} />
        </div>
      </div>
    </div>
  )
}

/** Pane body for a session ref (the `session` content kind). Workflow/settings
 *  and other destinations are dispatched by the content registry, not here. */
export function SessionPane({ refId }: { refId: string }) {
  const session = useAppStore((s) => s.sessions[refId])

  if (!session) {
    return null
  }

  // Terminal sessions run a PTY — no transcript/composer. The backend decides
  // whether to launch a provider CLI (native) or the shell from the session.
  if (session.kind === "terminal") {
    return <TerminalView sessionId={refId} workingDir={session.workingDir} />
  }

  return <AgentView sessionId={refId} />
}
