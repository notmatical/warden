import type { LucideIcon } from "lucide-react"
import { Search } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { Kbd } from "@/components/ui/kbd"
import { cn } from "@/lib/utils"
import { GATE_META, INTENT_META, INTENT_ORDER } from "@/lib/workflow-intents"
import type { Intent } from "@/types/workflow"

export type NodeKindChoice = Intent | "gate"

interface PaletteEntry {
  kind: NodeKindChoice
  label: string
  description: string
  icon: LucideIcon
  accent: string
  tile: string
}

const ENTRIES: PaletteEntry[] = [
  ...INTENT_ORDER.map((kind) => {
    const m = INTENT_META[kind]
    return {
      kind,
      label: m.label,
      description: m.description,
      icon: m.icon,
      accent: m.accent,
      tile: m.tile,
    }
  }),
  {
    kind: "gate",
    label: GATE_META.label,
    description: GATE_META.description,
    icon: GATE_META.icon,
    accent: GATE_META.accent,
    tile: GATE_META.tile,
  },
]

/** Unreal-style "place a node" search palette, anchored at a screen point
 *  (drag-release, right-click, or the toolbar's Add node button). */
export function NodePalette({
  screen,
  onPick,
  onClose,
}: {
  screen: { x: number; y: number }
  onPick: (kind: NodeKindChoice) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return ENTRIES
    return ENTRIES.filter(
      (e) =>
        e.label.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q)
    )
  }, [query])

  // Clamp during render so a narrowing list never points past its end, then
  // keep the highlighted row scrolled into view.
  const activeIndex = Math.min(active, Math.max(0, results.length - 1))
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`
    )
    el?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive(Math.min(activeIndex + 1, results.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive(Math.max(activeIndex - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const choice = results[activeIndex]
      if (choice) onPick(choice.kind)
    } else if (e.key === "Escape") {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default"
      />
      <div
        className="fixed z-50 flex max-h-[min(22rem,70vh)] w-64 flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-lg"
        style={{
          left: Math.min(screen.x, window.innerWidth - 272),
          top: Math.min(screen.y, window.innerHeight - 120),
        }}
      >
        <div className="flex items-center gap-2 border-b border-border/60 px-2.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Search nodes…"
            className="h-9 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/60"
          />
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1">
          {results.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No matching nodes
            </p>
          ) : (
            results.map((entry, i) => {
              const Icon = entry.icon
              return (
                <button
                  type="button"
                  key={entry.kind}
                  data-index={i}
                  onClick={() => onPick(entry.kind)}
                  onPointerMove={() => setActive(i)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left",
                    i === activeIndex && "bg-muted"
                  )}
                >
                  <div
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-lg",
                      entry.tile
                    )}
                  >
                    <Icon className={cn("size-4", entry.accent)} />
                  </div>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[13px] leading-tight">
                      {entry.label}
                    </span>
                    <span className="truncate text-[10px] text-muted-foreground">
                      {entry.description}
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/60 px-2.5 py-1.5 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd>
            add
          </span>
        </div>
      </div>
    </>
  )
}
