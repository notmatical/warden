import { Check, Loader2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import * as ipc from "@/lib/ipc"
import { isWindows } from "@/lib/platform"
import { cn } from "@/lib/utils"

const toLines = (commands: string[]) => commands.join("\n")
const toCommands = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

type TabId = "setup" | "teardown"

const TABS: {
  id: TabId
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
      "Absolute path of the main checkout — reach canonical files like .env without copying them into git.",
  },
]

const varToken = (name: string) => (isWindows ? `%${name}%` : `$${name}`)

type SaveState = "idle" | "saving" | "saved"

/** Edits the repo's `.warden/config.json` worktree commands, Superset-style:
 *  Setup/Teardown tabs, auto-save with a quiet Saved indicator, and one-click
 *  insertion of the template variables. Opened from the folder view header. */
export function WorktreeSetupDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [tab, setTab] = useState<TabId>("setup")
  const [values, setValues] = useState<Record<TabId, string>>({
    setup: "",
    teardown: "",
  })
  const [loading, setLoading] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Refs mirror state so debounced/unmount flushes never save stale text.
  const valuesRef = useRef(values)
  valuesRef.current = values
  const dirtyRef = useRef(false)
  const saveTimer = useRef<number | null>(null)
  const savedTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!open) return
    setTab("setup")
    setSaveState("idle")
    setLoading(true)
    ipc
      .getRepoConfig(projectId)
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
      await ipc.updateRepoConfig(projectId, {
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

  const setValue = (text: string) => {
    setValues((prev) => ({ ...prev, [tab]: text }))
    scheduleSave()
  }

  /** Insert a variable token at the textarea's caret, keeping focus there. */
  const insertVariable = (name: string) => {
    const token = varToken(name)
    const el = textareaRef.current
    const value = values[tab]
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? start
    setValue(value.slice(0, start) + token + value.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const active = useMemo(() => TABS.find((t) => t.id === tab) ?? TABS[0], [tab])

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

        {/* Tab bar + save indicator, Superset-style: quiet underline tabs,
            flush with the content's left edge. */}
        <div className="flex items-center gap-4 border-b border-border/60">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "relative h-8 text-sm font-medium transition-colors",
                tab === t.id
                  ? "text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
          <span
            aria-live="polite"
            className="ml-auto flex items-center gap-1 pr-1 text-[11px]"
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

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-muted-foreground">
              {active.hint} One command per line — chained with{" "}
              <span className="font-mono">&amp;&amp;</span>, so the first
              failure stops the rest.
            </p>
            <Textarea
              ref={textareaRef}
              key={tab}
              value={values[tab]}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => {
                if (saveTimer.current) window.clearTimeout(saveTimer.current)
                void save()
              }}
              placeholder={active.placeholder}
              rows={7}
              className="resize-y font-mono text-[13px] leading-relaxed"
              spellCheck={false}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                Variables
              </span>
              {VARIABLES.map((v) => (
                <Tooltip key={v.name}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => insertVariable(v.name)}
                      className="rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
                    >
                      {varToken(v.name)}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-64">
                    {v.description} Click to insert at the cursor.
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
