import { Check, ChevronLeft, Plus, Trash2 } from "lucide-react"
import { type ReactNode, useState } from "react"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"
import type { Label } from "@/types"

export const LABEL_COLORS: Record<
  string,
  { name: string; chip: string; dot: string }
> = {
  violet: {
    name: "Purple",
    chip: "bg-violet-500/10 text-violet-300 ring-violet-500/30",
    dot: "bg-violet-500",
  },
  blue: {
    name: "Blue",
    chip: "bg-blue-500/10 text-blue-400 ring-blue-500/30",
    dot: "bg-blue-500",
  },
  teal: {
    name: "Teal",
    chip: "bg-teal-500/10 text-teal-300 ring-teal-500/30",
    dot: "bg-teal-500",
  },
  green: {
    name: "Green",
    chip: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/30",
    dot: "bg-emerald-500",
  },
  amber: {
    name: "Yellow",
    chip: "bg-amber-500/10 text-amber-300 ring-amber-500/30",
    dot: "bg-amber-400",
  },
  orange: {
    name: "Orange",
    chip: "bg-orange-500/10 text-orange-400 ring-orange-500/30",
    dot: "bg-orange-500",
  },
  pink: {
    name: "Pink",
    chip: "bg-pink-500/10 text-pink-400 ring-pink-500/30",
    dot: "bg-pink-500",
  },
  red: {
    name: "Red",
    chip: "bg-red-500/10 text-red-400 ring-red-500/30",
    dot: "bg-red-500",
  },
}

export function labelColor(color: string) {
  return LABEL_COLORS[color] ?? LABEL_COLORS.blue
}

export function LabelChip({ label }: { label: Label }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-[9rem] items-center gap-1 rounded-md px-2 py-0.5 font-medium text-[11px] ring-1 ring-inset",
        labelColor(label.color).chip
      )}
    >
      <span className="truncate">{label.name}</span>
    </span>
  )
}

export function LabelPicker({
  projectId,
  sessionId,
  attached,
  children,
}: {
  projectId: string
  sessionId: string
  attached: string[]
  children: ReactNode
}) {
  // Default outside the selector — returning a fresh `[]` from it would loop
  // useSyncExternalStore.
  const labels = useAppStore((s) => s.labelsByProject[projectId]) ?? []
  const createLabel = useAppStore((s) => s.createLabel)
  const deleteLabel = useAppStore((s) => s.deleteLabel)
  const setSessionLabels = useAppStore((s) => s.setSessionLabels)
  const [query, setQuery] = useState("")
  const [coloring, setColoring] = useState<string | null>(null)

  const attachedSet = new Set(attached)
  const q = query.trim().toLowerCase()
  const filtered = labels.filter((l) => l.name.toLowerCase().includes(q))
  const exact = labels.some((l) => l.name.toLowerCase() === q)

  const reset = () => {
    setQuery("")
    setColoring(null)
  }

  const toggle = (labelId: string) => {
    const next = attachedSet.has(labelId)
      ? attached.filter((id) => id !== labelId)
      : [...attached, labelId]
    void setSessionLabels(sessionId, next)
  }

  const create = async (color: string) => {
    const name = (coloring ?? query).trim()
    if (!name) return
    const label = await createLabel(projectId, name, color)
    if (label) {
      void setSessionLabels(sessionId, [...attached, label.id])
      reset()
    }
  }

  return (
    <Popover onOpenChange={(open) => !open && reset()}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64 p-0"
        onClick={(e) => e.stopPropagation()}
        onEscapeKeyDown={(e) => {
          // pressing escape goes back instead of closing.
          if (coloring !== null) {
            e.preventDefault()
            setColoring(null)
          }
        }}
      >
        {coloring === null ? (
          <>
            <div className="border-border/60 border-b p-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && q && !exact) {
                    e.preventDefault()
                    setColoring(query.trim())
                  }
                }}
                placeholder="Add labels…"
                // biome-ignore lint/a11y/noAutofocus: picker opens focused for typing
                autoFocus
                className="h-7 w-full rounded-md bg-input/50 px-2 text-[13px] outline-none placeholder:text-muted-foreground/60"
              />
            </div>
            <div className="max-h-64 overflow-y-auto p-1">
              {filtered.map((l) => (
                <div
                  key={l.id}
                  className="group/lrow flex items-center rounded-md pr-1 transition-colors hover:bg-accent"
                >
                  <button
                    type="button"
                    onClick={() => toggle(l.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-[13px]"
                  >
                    <span
                      className={cn(
                        "size-2.5 shrink-0 rounded-full",
                        labelColor(l.color).dot
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{l.name}</span>
                    {attachedSet.has(l.id) ? (
                      <Check className="size-3.5 shrink-0 text-foreground" />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      void deleteLabel(l.id)
                    }}
                    aria-label={`Delete label ${l.name}`}
                    title="Delete label (removes it from all sessions)"
                    className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground/50 opacity-0 transition group-hover/lrow:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
              {q && !exact ? (
                <button
                  type="button"
                  onClick={() => setColoring(query.trim())}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent"
                >
                  <Plus className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    Create new label:{" "}
                    <span className="text-muted-foreground">
                      “{query.trim()}”
                    </span>
                  </span>
                </button>
              ) : null}
              {!q && labels.length === 0 ? (
                <p className="flex items-center gap-2 px-2 py-1.5 text-[13px] text-muted-foreground/70">
                  <Plus className="size-3.5 shrink-0" />
                  Start typing to create a new label
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setColoring(null)}
              className="flex w-full items-center gap-1.5 border-border/60 border-b px-2.5 py-2 text-left text-muted-foreground text-xs transition-colors hover:text-foreground"
            >
              <ChevronLeft className="size-3.5 shrink-0" />
              Pick a color for label
            </button>
            <div className="max-h-64 overflow-y-auto p-1">
              {Object.entries(LABEL_COLORS).map(([key, c]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => void create(key)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent"
                >
                  <span
                    className={cn("size-2.5 shrink-0 rounded-full", c.dot)}
                  />
                  {c.name}
                </button>
              ))}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
