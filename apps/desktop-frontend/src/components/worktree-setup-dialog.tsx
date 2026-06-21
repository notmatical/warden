import { Check, Loader2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Callout } from "@/components/ui/callout"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import * as ipc from "@/lib/ipc"
import { isWindows } from "@/lib/platform"

const toLines = (commands: string[]) => commands.join("\n")
const toCommands = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

type SectionId = "setup" | "teardown"

const SECTIONS: {
  id: SectionId
  label: string
  hint: string
  placeholder: string
}[] = [
  {
    id: "setup",
    label: "Setup",
    hint: "Runs in every fresh worktree right after it's created.",
    placeholder: "pnpm install\npnpm run db:migrate",
  },
  {
    id: "teardown",
    label: "Teardown",
    hint: "Runs in a worktree just before it's removed (best-effort, 30s cap).",
    placeholder: "docker compose down",
  },
]

/** Template variables warden injects into setup/teardown commands, rendered in
 *  the platform's shell syntax (`%VAR%` under cmd.exe, `$VAR` under sh). */
const VARIABLES: { name: string; description: string }[] = [
  {
    name: "WARDEN_WORKTREE_PATH",
    description: "Absolute path of the fresh worktree (the working directory).",
  },
  {
    name: "WARDEN_ROOT_PATH",
    description:
      "Absolute path of the main checkout, for reaching canonical files like .env without copying them into git.",
  },
]

const varToken = (name: string) => (isWindows ? `%${name}%` : `$${name}`)

type SaveState = "idle" | "saving" | "saved"

/** Edits the repo's `.warden/config.json` worktree commands: stacked
 *  Setup/Teardown sections, auto-save with a quiet Saved indicator, and
 *  one-click insertion of the template variables. Opened from the folder
 *  view header. */
export function WorktreeSetupDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [values, setValues] = useState<Record<SectionId, string>>({
    setup: "",
    teardown: "",
  })
  const [loading, setLoading] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const textareaRefs = useRef<Record<SectionId, HTMLTextAreaElement | null>>({
    setup: null,
    teardown: null,
  })
  // Variable chips insert into whichever section was edited last.
  const lastFocusedRef = useRef<SectionId>("setup")

  // Refs mirror state so debounced/unmount flushes never save stale text.
  const valuesRef = useRef(values)
  valuesRef.current = values
  const dirtyRef = useRef(false)
  const saveTimer = useRef<number | null>(null)
  const savedTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!open) return
    setSaveState("idle")
    setLoading(true)
    ipc
      .getWorktreeConfig(projectId)
      .then((config) => {
        setValues({
          setup: toLines(config.setup),
          teardown: toLines(config.teardown),
        })
        dirtyRef.current = false
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : String(error))
        onOpenChange(false)
      })
      .finally(() => setLoading(false))
  }, [open, projectId, onOpenChange])

  const save = useCallback(async () => {
    if (!dirtyRef.current) return
    dirtyRef.current = false
    setSaveState("saving")
    try {
      await ipc.updateWorktreeConfig(projectId, {
        setup: toCommands(valuesRef.current.setup),
        teardown: toCommands(valuesRef.current.teardown),
      })
      setSaveState("saved")
      if (savedTimer.current) window.clearTimeout(savedTimer.current)
      savedTimer.current = window.setTimeout(() => setSaveState("idle"), 2000)
    } catch (error) {
      dirtyRef.current = true
      setSaveState("idle")
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [projectId])

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void save(), 600)
  }, [save])

  // Closing flushes a pending edit so nothing typed is ever lost.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      void save()
    }
    onOpenChange(next)
  }

  const setValue = (id: SectionId, text: string) => {
    setValues((prev) => ({ ...prev, [id]: text }))
    scheduleSave()
  }

  /** Insert a variable token at the caret of the last-focused textarea,
   *  keeping focus there. */
  const insertVariable = (name: string) => {
    const token = varToken(name)
    const id = lastFocusedRef.current
    const el = textareaRefs.current[id]
    const value = values[id]
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? start
    setValue(id, value.slice(0, start) + token + value.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[min(620px,calc(100vw-2rem))] max-w-none sm:max-w-none">
        <DialogHeader className="pr-8">
          <DialogTitle>Worktree commands</DialogTitle>
          <DialogDescription>
            Run automatically around every isolated worktree. Saved to{" "}
            <span className="font-mono">.warden/config.json</span> so the whole
            team shares them.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Callout variant="info">
              Each line runs as its own command, in order. If one fails, the
              rest are skipped.
            </Callout>

            {SECTIONS.map(({ id, label, hint, placeholder }) => (
              <div key={id} className="flex flex-col gap-1.5">
                <div className="space-y-0.5">
                  <Label htmlFor={`worktree-${id}-commands`}>{label}</Label>
                  <p className="text-xs text-muted-foreground">{hint}</p>
                </div>
                <Textarea
                  ref={(el) => {
                    textareaRefs.current[id] = el
                  }}
                  id={`worktree-${id}-commands`}
                  value={values[id]}
                  onChange={(e) => setValue(id, e.target.value)}
                  onFocus={() => {
                    lastFocusedRef.current = id
                  }}
                  onBlur={() => {
                    if (saveTimer.current)
                      window.clearTimeout(saveTimer.current)
                    void save()
                  }}
                  placeholder={placeholder}
                  rows={4}
                  className="resize-y font-mono text-[13px] leading-relaxed"
                  spellCheck={false}
                />
              </div>
            ))}

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                Variables
              </span>
              {VARIABLES.map((v) => (
                <Tooltip key={v.name}>
                  <TooltipTrigger asChild>
                    <Badge asChild variant="secondary">
                      <button
                        type="button"
                        onClick={() => insertVariable(v.name)}
                        className="cursor-pointer font-mono"
                      >
                        {varToken(v.name)}
                      </button>
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-64">
                    {v.description} Click to insert at the cursor.
                  </TooltipContent>
                </Tooltip>
              ))}
              <span
                aria-live="polite"
                className="ml-auto flex items-center gap-1 text-[11px]"
              >
                {saveState === "saving" ? (
                  <span className="text-muted-foreground">Saving…</span>
                ) : saveState === "saved" ? (
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <Check className="size-3" />
                    Saved
                  </span>
                ) : null}
              </span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
