import { RefreshCw, TriangleAlert } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { Composer } from "@/components/composer"
import { TerminalView } from "@/components/terminal-view"
import { Transcript } from "@/components/transcript"
import { Button } from "@/components/ui/button"
import { EdgeFade } from "@/components/ui/edge-fade"
import { ErrorState } from "@/components/ui/error-state"
import * as ipc from "@/lib/ipc"
import { useAppStore } from "@/store/app-store"
import type { Session } from "@/types"

/** Full-pane state when the worktree's setup commands failed: what broke (raw
 *  output), and the ways out — retry, work without setup, or eyeball the tree. */
function SetupFailedState({ session }: { session: Session }) {
  const [retrying, setRetrying] = useState(false)
  const retry = async () => {
    setRetrying(true)
    try {
      await ipc.retryWorktreeSetup(session.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setRetrying(false)
    }
  }
  return (
    <ErrorState
      icon={TriangleAlert}
      title="Worktree setup failed"
      description={
        <>
          The setup commands from{" "}
          <span className="font-mono text-xs">.warden/config.json</span>{" "}
          stopped on an error, so this worktree may be missing dependencies.
        </>
      }
      detail={session.setupError}
      detailLabel="Setup output"
      actions={
        <>
          <Button size="sm" onClick={() => void retry()} disabled={retrying}>
            <RefreshCw className={retrying ? "animate-spin" : undefined} />
            Retry setup
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              void ipc
                .dismissSetupError(session.id)
                .catch((error) =>
                  toast.error(
                    error instanceof Error ? error.message : String(error)
                  )
                )
            }
          >
            Continue anyway
          </Button>
        </>
      }
    />
  )
}

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

  // A failed worktree setup takes over the pane: the agent would otherwise run
  // in a half-initialized tree. Retry/dismiss both come back through
  // session-updated events.
  if (session.setupStatus === "failed") {
    return <SetupFailedState session={session} />
  }

  return <AgentView sessionId={refId} />
}
