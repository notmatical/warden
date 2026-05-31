import { FolderOpen, MessageSquarePlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useAppStore } from "@/store/app-store"

export function EmptyState({
  variant,
}: {
  variant: "no-workspace" | "no-session"
}) {
  const openWorkspace = useAppStore((s) => s.openWorkspace)

  if (variant === "no-workspace") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="flex size-14 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <FolderOpen className="size-6" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-medium">No workspace open</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Open a git repository to start running agent sessions in isolated
            worktrees.
          </p>
        </div>
        <Button onClick={() => void openWorkspace()}>
          <FolderOpen />
          Open folder…
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex size-14 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <MessageSquarePlus className="size-6" />
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-medium">No session selected</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Use the omnibox above to start a new agent session, or pick a tab.
        </p>
      </div>
    </div>
  )
}
