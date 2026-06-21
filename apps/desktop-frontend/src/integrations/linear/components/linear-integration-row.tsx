import { Loader2 } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"
import { toast } from "sonner"

import { LinearIcon } from "@/components/icons/brand"
import { ToolListRow } from "@/components/settings/tool-list"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import { linearConnect, linearDisconnect, linearStatus } from "../ipc"

type Phase = "loading" | "disconnected" | "connected"

/** Linear row for Settings → Integrations. API-key based (no CLI to manage):
 *  paste a personal key to connect, one click to disconnect. */
export function LinearIntegrationRow() {
  const [phase, setPhase] = useState<Phase>("loading")
  const [keyInput, setKeyInput] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    linearStatus()
      .then(({ connected }) =>
        setPhase(connected ? "connected" : "disconnected")
      )
      .catch(() => setPhase("disconnected"))
  }, [])

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
      toast.error("Couldn't connect to Linear", { description: String(e) })
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
      toast.error("Couldn't disconnect", { description: String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ToolListRow
      icon={LinearIcon}
      name="Linear"
      ghost={phase !== "connected"}
      state={
        phase === "connected"
          ? { kind: "ok", label: "Connected" }
          : { kind: "off", label: "Not connected" }
      }
      description="Triage your assigned issues in Tasks and send them to agents."
      actions={
        phase === "connected" ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void handleDisconnect()}
            disabled={busy}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : "Disconnect"}
          </Button>
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
              variant="ghost"
              size="xs"
              disabled={busy || phase === "loading" || !keyInput.trim()}
              className="bg-foreground text-background hover:bg-foreground/90"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : "Connect"}
            </Button>
          </form>
        )
      }
    />
  )
}
