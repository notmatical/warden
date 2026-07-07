import { AgentToolbar } from "@/components/agent-panel"
import { ContextMeter } from "@/components/context-meter"
import { EffortSelector } from "@/components/selectors/effort-selector"
import { ModeSelector } from "@/components/selectors/mode-selector"
import { ModelSelector } from "@/components/selectors/model-selector"
import { useAppStore } from "@/store/app-store"
import type { Session } from "@/types"

interface ComposerToolbarProps {
  session: Session
  sessionId: string
  /** Whether the session has taken a turn; locks the provider once started. */
  started: boolean
  /** Wires each selector's open state so only one menu is open at a time. */
  menuProps: (id: "model" | "mode" | "effort") => {
    open: boolean
    onOpenChange: (open: boolean) => void
  }
}

/** The settings panel tucked behind the input card: the model, mode, and effort
 *  selectors on the left; the context meter and sub-agents on the right. */
export function ComposerToolbar({
  session,
  sessionId,
  started,
  menuProps,
}: ComposerToolbarProps) {
  const updateSession = useAppStore((s) => s.updateSession)

  return (
    <div className="-mt-3 flex items-center gap-1 rounded-b-xl bg-muted/40 px-2 pt-5 pb-1.5">
      <ModelSelector
        value={session.model}
        backend={session.backend}
        started={started}
        onChange={(model) => void updateSession(sessionId, { model })}
        {...menuProps("model")}
      />
      <div className="mx-0.5 h-4 w-px bg-border/60" />
      <ModeSelector
        value={session.permissionMode}
        onChange={(permissionMode) =>
          void updateSession(sessionId, { permissionMode })
        }
        {...menuProps("mode")}
      />
      <EffortSelector
        value={session.effort}
        onChange={(effort) => void updateSession(sessionId, { effort })}
        backend={session.backend}
        {...menuProps("effort")}
      />

      <div className="ml-auto flex items-center gap-1">
        <ContextMeter sessionId={sessionId} />
        <AgentToolbar sessionId={sessionId} />
      </div>
    </div>
  )
}
