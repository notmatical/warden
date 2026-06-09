import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import * as ipc from "@/lib/ipc"

const toLines = (commands: string[]) => commands.join("\n")
const toCommands = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

/** Edits the repo's `.warden/config.json` worktree commands: setup runs in
 *  every fresh worktree, teardown right before one is removed. Controlled —
 *  opened from the folder view header. */
export function WorktreeSetupDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [setup, setSetup] = useState("")
  const [teardown, setTeardown] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    ipc
      .getRepoConfig(projectId)
      .then((config) => {
        setSetup(toLines(config.setup))
        setTeardown(toLines(config.teardown))
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : String(error))
        onOpenChange(false)
      })
      .finally(() => setLoading(false))
  }, [open, projectId, onOpenChange])

  const save = async () => {
    setSaving(true)
    try {
      await ipc.updateRepoConfig(projectId, {
        setup: toCommands(setup),
        teardown: toCommands(teardown),
      })
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(560px,calc(100vw-2rem))] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Worktree commands</DialogTitle>
          <DialogDescription>
            Saved to <span className="font-mono">.warden/config.json</span> in
            the repo, so the whole team shares them. One command per line; they
            run chained with <span className="font-mono">&amp;&amp;</span>.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="worktree-setup">Setup</Label>
              <Textarea
                id="worktree-setup"
                value={setup}
                onChange={(e) => setSetup(e.target.value)}
                placeholder={"pnpm install\ncp $WARDEN_ROOT_PATH/.env .env"}
                className="min-h-24 font-mono text-[13px]"
                spellCheck={false}
              />
              <p className="text-[11px] text-muted-foreground">
                Runs in every fresh worktree right after it's created.{" "}
                <span className="font-mono">$WARDEN_WORKTREE_PATH</span> and{" "}
                <span className="font-mono">$WARDEN_ROOT_PATH</span> point at
                the worktree and the main checkout.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="worktree-teardown">Teardown</Label>
              <Textarea
                id="worktree-teardown"
                value={teardown}
                onChange={(e) => setTeardown(e.target.value)}
                placeholder="docker compose down"
                className="min-h-16 font-mono text-[13px]"
                spellCheck={false}
              />
              <p className="text-[11px] text-muted-foreground">
                Runs in a worktree just before it's removed (best-effort).
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={loading || saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
