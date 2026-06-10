import { Loader2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { linearSetBinding, linearTeams } from "../ipc"
import type { LinearBinding, LinearTeam } from "../types"

const ALL_PROJECTS = "__all__"

type TeamsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; teams: LinearTeam[] }

/** Bind a repo to a Linear team (optionally narrowed to a project). The
 *  binding lands in the repo's committable .warden/config.json. */
export function BindRepoDialog({
  projectId,
  existing,
  open,
  onOpenChange,
  onBound,
}: {
  projectId: string
  existing: LinearBinding | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onBound: () => void
}) {
  const [teams, setTeams] = useState<TeamsState>({ status: "loading" })
  const [teamId, setTeamId] = useState("")
  const [linearProjectId, setLinearProjectId] = useState(ALL_PROJECTS)
  const [saving, setSaving] = useState(false)

  const loadTeams = useCallback(() => {
    setTeams({ status: "loading" })
    linearTeams()
      .then((list) => setTeams({ status: "loaded", teams: list }))
      .catch((e) => setTeams({ status: "error", message: String(e) }))
  }, [])

  useEffect(() => {
    if (!open) return
    setTeamId(existing?.teamId ?? "")
    setLinearProjectId(existing?.projectId ?? ALL_PROJECTS)
    loadTeams()
  }, [open, existing, loadTeams])

  const team =
    teams.status === "loaded"
      ? teams.teams.find((t) => t.id === teamId)
      : undefined

  const save = async (binding: LinearBinding | null) => {
    setSaving(true)
    try {
      await linearSetBinding(projectId, binding)
      onOpenChange(false)
      onBound()
    } catch (e) {
      toast.error("Couldn't update binding", { description: String(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bind to Linear</DialogTitle>
          <DialogDescription>
            Issues from the chosen team show up in this folder's Tasks tab. The
            binding is saved to .warden/config.json and travels with the repo.
          </DialogDescription>
        </DialogHeader>

        {teams.status === "loading" ? (
          <div className="flex items-center gap-2 py-2 text-muted-foreground text-sm">
            <Loader2 className="size-3.5 animate-spin" />
            Loading teams…
          </div>
        ) : teams.status === "error" ? (
          <div className="flex flex-col items-start gap-2 py-2">
            <p className="text-muted-foreground text-sm">
              Couldn't load teams: {teams.message}
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="h-7"
              onClick={loadTeams}
            >
              Retry
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">Team</span>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pick a team" />
                </SelectTrigger>
                <SelectContent>
                  {teams.teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="font-mono text-muted-foreground text-xs">
                        {t.key}
                      </span>{" "}
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">Project</span>
              <Select
                value={linearProjectId}
                onValueChange={setLinearProjectId}
                disabled={!team}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
                  {(team?.projects ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          {existing ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => void save(null)}
              className="mr-auto text-muted-foreground"
            >
              Remove binding
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!teamId || saving || teams.status !== "loaded"}
            onClick={() =>
              void save({
                teamId,
                projectId:
                  linearProjectId === ALL_PROJECTS ? null : linearProjectId,
              })
            }
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Save binding
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
