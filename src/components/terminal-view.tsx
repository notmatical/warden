import { useCallback, useEffect, useRef, useState } from "react"
import { TerminalSquare } from "lucide-react"

import { Button } from "@/components/ui/button"
import * as ipc from "@/lib/ipc"
import * as terminals from "@/lib/terminal-instances"
import { useAppStore } from "@/store/app-store"

/** Hosts a persistent xterm instance for a terminal session: attaches it on
 *  mount, refits on container resize, and detaches (without disposing) on
 *  unmount so the scrollback and PTY survive tab switches.
 *
 *  When a session whose PTY has previously started is reopened with no live
 *  instance (the tab was closed, or the app relaunched), we don't silently
 *  respawn — we show an ended state and let the user resume or start fresh. */
export function TerminalView({
  sessionId,
  workingDir,
}: {
  sessionId: string
  workingDir: string
}) {
  // Live instance → attach as today. Else previously-started → ended state (no
  // silent respawn). Else never started → auto-start fresh. The decision is
  // taken once at mount, so read the flag via getState() rather than
  // subscribing (its later changes must not re-derive this branch).
  const [mounted, setMounted] = useState(() => {
    if (terminals.has(sessionId)) return true
    return !useAppStore.getState().sessions[sessionId]?.ptyStarted
  })
  const mount = useCallback(() => setMounted(true), [])

  return mounted ? (
    <TerminalSurface sessionId={sessionId} workingDir={workingDir} />
  ) : (
    <EndedState sessionId={sessionId} onMount={mount} />
  )
}

function TerminalSurface({
  sessionId,
  workingDir,
}: {
  sessionId: string
  workingDir: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    terminals.attach(sessionId, container, workingDir)

    // Coalesce resize bursts to one fit per frame. Without this, fit() mutates
    // the observed element's size and re-triggers the observer in a tight loop.
    let frame = 0
    const observer = new ResizeObserver(() => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        terminals.fit(sessionId)
      })
    })
    observer.observe(container)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      terminals.detach(sessionId)
    }
  }, [sessionId, workingDir])

  return <div ref={containerRef} className="h-full w-full overflow-hidden p-2" />
}

function EndedState({
  sessionId,
  onMount,
}: {
  sessionId: string
  onMount: () => void
}) {
  // Resume reattaches and the backend picks --resume (ptyStarted is set here).
  // Start fresh first abandons the conversation (new id, cleared flag) so the
  // next spawn opens a new one.
  const resume = useCallback(() => onMount(), [onMount])
  const startFresh = useCallback(() => {
    void ipc.resetTerminalSession(sessionId).then(onMount)
  }, [sessionId, onMount])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex size-14 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <TerminalSquare className="size-6" />
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-medium">Session ended</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          This terminal's process was closed. Resume the conversation or start
          a fresh one.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={resume}>Resume session</Button>
        <Button variant="ghost" onClick={startFresh}>
          Start fresh
        </Button>
      </div>
    </div>
  )
}
