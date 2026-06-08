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
}

/** Shared install/update/sign-in state for a CLI-backed tool. Subscribes to the
 *  backend's `cli:install-progress` stream and derives the next action label. */
export function useToolInstall({
  status,
  onInstall,
  onUpdate,
  onSignIn,
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
    action = {
      label: "Install",
      primary: true,
      onClick: () => void run(onInstall),
    }
  } else if (!status.authed && onSignIn) {
    action = { label: "Sign in", primary: true, onClick: onSignIn }
  } else if (status.updateAvailable) {
    action = {
      label: "Update",
      primary: false,
      onClick: () => void run(onUpdate),
    }
  }

  return { busy, progress, action }
}

/** Connection-state label + tone — muted when fine, accented only when action
 *  is due. Used by both ToolRow and IntegrationCard. */
export function connectionState(status: ProviderStatus): {
  label: string
  tone: string
} {
  if (!status.installed)
    return { label: "Not installed", tone: "text-muted-foreground" }
  if (!status.authed)
    return {
      label: "Not signed in",
      tone: "text-amber-600 dark:text-amber-500",
    }
  return { label: "Connected", tone: "text-emerald-600 dark:text-emerald-500" }
}
