import { FolderGit2, FolderPlus, MessageSquarePlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useAppStore } from "@/store/app-store"

export function EmptyState({
  variant,
}: {
  variant: "no-project" | "no-root" | "no-session"
}) {
  const createGroup = useAppStore((s) => s.createGroup)
  const addRoot = useAppStore((s) => s.addRoot)

  if (variant === "no-project") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="flex size-14 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <FolderPlus className="size-6" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-medium">No group open</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Create a group to organize repositories and run agent sessions in
            isolated worktrees.
          </p>
        </div>
        <Button onClick={() => void createGroup("New group")}>
          <FolderPlus />
          New group
        </Button>
      </div>
    )
  }

  if (variant === "no-root") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="flex size-14 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <FolderGit2 className="size-6" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-medium">No folder in this group</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Add a repository folder to this group, then start agent or terminal
            sessions against it.
          </p>
        </div>
        <Button
          onClick={() => {
            const groupId = useAppStore.getState().activeGroupId
            if (groupId) void addRoot(groupId)
          }}
        >
          <FolderPlus />
          Add folder
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
          Pick a session from the sidebar, or start one from a folder's +
          menu.
        </p>
      </div>
    </div>
  )
}
