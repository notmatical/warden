import { useState } from "react"

import { LinearIcon } from "@/components/icons/brand"
import { Button } from "@/components/ui/button"

import { BindRepoDialog } from "./bind-repo-dialog"

/** Slim hint shown under a folder's header when Linear is connected but the
 *  repo carries no binding yet. */
export function BindLinearBanner({
  projectId,
  onBound,
}: {
  projectId: string
  onBound: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <div className="flex items-center gap-2.5 rounded-lg border border-border/60 border-dashed px-3.5 py-2">
        <LinearIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
        <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
          Link this folder to a Linear team to see its tasks here.
        </span>
        <Button
          variant="secondary"
          size="xs"
          onClick={() => setOpen(true)}
          className="shrink-0"
        >
          Bind to Linear
        </Button>
      </div>
      <BindRepoDialog
        projectId={projectId}
        existing={null}
        open={open}
        onOpenChange={setOpen}
        onBound={onBound}
      />
    </>
  )
}
