import { useEffect, useRef, useState } from "react"

import { Composer } from "@/components/composer"
import { TerminalView } from "@/components/terminal-view"
import { Transcript } from "@/components/transcript"
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
      <div
        ref={overlayRef}
        className="pointer-events-none absolute inset-x-0 bottom-0"
      >
        <div className="h-6 bg-gradient-to-t from-background to-transparent" />
        <div className="pointer-events-auto bg-background">
          <Composer sessionId={sessionId} />
        </div>
      </div>
    </div>
  )
}

export function SessionView({ sessionId }: { sessionId: string }) {
  const session = useAppStore((s) => s.sessions[sessionId])

  if (!session) {
    return null
  }

  // Terminal sessions run the shell in a PTY — no transcript/composer.
  if (session.kind === "terminal") {
    return <TerminalView sessionId={sessionId} workingDir={session.workingDir} />
  }

  return <AgentView sessionId={sessionId} />
}
