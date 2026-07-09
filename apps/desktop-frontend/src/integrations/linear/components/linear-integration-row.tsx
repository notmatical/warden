import { Button } from "@warden/ui/components/button"
import { Input } from "@warden/ui/components/input"
import { Switch } from "@warden/ui/components/switch"
import { type FormEvent, useEffect, useState } from "react"
import { toast } from "sonner"

import { LinearIcon } from "@/components/icons/brand"
import { StatusPill, ToolListRow } from "@/components/settings/tool-list"
import { setWardenMcpEnabled, wardenMcpEnabled } from "@/lib/ipc"
import { errorMessage } from "@/store/shared"

import { linearConnect, linearDisconnect, linearStatus } from "../ipc"

type Phase = "loading" | "disconnected" | "connected"

/** Linear row for Settings → Integrations. API-key based (no CLI to manage):
 *  paste a personal key to connect, one click to disconnect. */
export function LinearIntegrationRow() {
  const [phase, setPhase] = useState<Phase>("loading")
  const [keyInput, setKeyInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [agentTools, setAgentTools] = useState(true)

  useEffect(() => {
    linearStatus()
      .then(({ connected }) =>
        setPhase(connected ? "connected" : "disconnected")
      )
      .catch(() => setPhase("disconnected"))
  }, [])

  useEffect(() => {
    if (phase !== "connected") return
    wardenMcpEnabled()
      .then(setAgentTools)
      .catch(() => {})
  }, [phase])

  const toggleAgentTools = (next: boolean) => {
    setAgentTools(next) // optimistic; the setting read on next spawn is source of truth
    void setWardenMcpEnabled(next).catch(() => {
      setAgentTools(!next)
      toast.error("Couldn't update agent access")
    })
  }

  const handleConnect = async (e: FormEvent) => {
    e.preventDefault()
    const key = keyInput.trim()
    if (!key) return
    setBusy(true)
    try {
      const viewer = await linearConnect(key)
      setKeyInput("")
      setPhase("connected")
      toast.success(`Connected to Linear as ${viewer.name}`)
    } catch (e) {
      toast.error("Couldn't connect to Linear", {
        description: errorMessage(e),
      })
    } finally {
      setBusy(false)
    }
  }

  const handleDisconnect = async () => {
    setBusy(true)
    try {
      await linearDisconnect()
      setPhase("disconnected")
    } catch (e) {
      toast.error("Couldn't disconnect", { description: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ToolListRow
      icon={LinearIcon}
      name="Linear"
      ghost={phase !== "connected"}
      description="Triage your assigned issues in Tasks and send them to agents."
      band={
        phase === "connected" ? (
          <div className="flex items-center justify-between gap-3 border-border/60 border-t bg-muted/20 px-4 py-2.5">
            <div className="min-w-0">
              <p className="font-medium text-foreground text-xs">
                Let agents manage issues
              </p>
              <p className="text-[11px] text-muted-foreground">
                Agents can create issues, comment, and update status during a
                session.
              </p>
            </div>
            <Switch checked={agentTools} onCheckedChange={toggleAgentTools} />
          </div>
        ) : undefined
      }
      actions={
        phase === "connected" ? (
          <>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void handleDisconnect()}
              loading={busy}
              className="text-destructive-foreground opacity-0 transition-opacity hover:bg-destructive/10 group-hover:opacity-100 group-focus-within:opacity-100"
            >
              Disconnect
            </Button>
            <StatusPill kind="ok" label="Connected" />
          </>
        ) : (
          <form onSubmit={handleConnect} className="flex items-center gap-2">
            <Input
              type="password"
              autoComplete="off"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="lin_api_…"
              disabled={phase === "loading"}
              className="h-7 w-44 font-mono text-xs"
            />
            <Button
              type="submit"
              size="xs"
              loading={busy}
              disabled={phase === "loading" || !keyInput.trim()}
            >
              Connect
            </Button>
          </form>
        )
      }
    />
  )
}
