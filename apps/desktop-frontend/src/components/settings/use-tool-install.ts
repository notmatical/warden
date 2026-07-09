import { listen } from "@tauri-apps/api/event"
import { useEffect, useState } from "react"

import type { ProviderStatus } from "@/types"

export interface InstallProgress {
  tool: string
  stage: string
  message: string
  percent: number
}

export interface ToolAction {
  label: string
  primary: boolean
  onClick: () => void
}

export interface UseToolInstallOptions {
  status: ProviderStatus
  onInstall: () => Promise<void>
  onUpdate: () => Promise<void>
  /** When the tool is unauthenticated, a "Sign in" action shows. */
  onSignIn?: () => void
  /** Whether warden can install this tool on this platform. False suppresses the
   *  Install action (e.g. Cursor on Windows, which needs WSL). Defaults to true. */
  installable?: boolean
}

/** Shared install/update/sign-in state for a CLI-backed tool. Subscribes to the
 *  backend's `cli:install-progress` stream and derives the next action label. */
export function useToolInstall({
  status,
  onInstall,
  onUpdate,
  onSignIn,
  installable = true,
}: UseToolInstallOptions) {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<InstallProgress | null>(null)

  useEffect(() => {
    const unlisten = listen<InstallProgress>("cli:install-progress", (e) => {
      if (e.payload.tool === status.id) setProgress(e.payload)
    })
    return () => void unlisten.then((off) => off())
  }, [status.id])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  let action: ToolAction | null = null
  if (!status.installed) {
    action = installable
      ? { label: "Install", primary: true, onClick: () => void run(onInstall) }
      : null
  } else if (!status.authed && onSignIn) {
    action = { label: "Sign in", primary: true, onClick: onSignIn }
  } else if (status.updateAvailable) {
    action = {
      label: "Update",
      primary: false,
      onClick: () => void run(onUpdate),
    }
  }

  return { busy, progress, action, runUpdate: () => void run(onUpdate) }
}
