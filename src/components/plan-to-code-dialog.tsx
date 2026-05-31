import { useState } from "react"
import { Workflow } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  DEFAULT_CODER_MODEL,
  DEFAULT_PLANNER_MODEL,
  MODELS,
} from "@/lib/models"
import { useAppStore } from "@/store/app-store"

export function PlanToCodeDialog({ disabled }: { disabled?: boolean }) {
  const runPlanToCode = useAppStore((s) => s.runPlanToCode)

  const [open, setOpen] = useState(false)
  const [task, setTask] = useState("")
  const [plannerModel, setPlannerModel] = useState(DEFAULT_PLANNER_MODEL)
  const [coderModel, setCoderModel] = useState(DEFAULT_CODER_MODEL)
  const [submitting, setSubmitting] = useState(false)

  const canRun = task.trim().length > 0 && !submitting

  const run = async () => {
    if (!canRun) return
    setSubmitting(true)
    try {
      await runPlanToCode({
        task: task.trim(),
        plannerModel,
        coderModel,
      })
      setTask("")
      setOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          <Workflow />
          Plan → Code
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Plan → Code</DialogTitle>
          <DialogDescription>
            Hand a planner&apos;s output off to a coder. Both share one isolated
            worktree.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="ptc-task">Task</Label>
            <Textarea
              id="ptc-task"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              rows={5}
              placeholder="Describe what should be built…"
              className="resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Planner</Label>
              <Select value={plannerModel} onValueChange={setPlannerModel}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Coder</Label>
              <Select value={coderModel} onValueChange={setCoderModel}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => void run()} disabled={!canRun}>
            {submitting ? "Running…" : "Run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
