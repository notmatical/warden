import { Columns2, Grid2x2, PanelBottom, Rows2, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { withMode } from "@/lib/layout"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"
import type { LayoutMode } from "@/types"

const MODES: { mode: LayoutMode; label: string; Icon: typeof Square }[] = [
  { mode: "single", label: "Single pane", Icon: Square },
  { mode: "cols-2", label: "Two columns", Icon: Columns2 },
  { mode: "rows-2", label: "Two rows", Icon: Rows2 },
  { mode: "three", label: "Two over one", Icon: PanelBottom },
  { mode: "grid-4", label: "Four-pane grid", Icon: Grid2x2 },
]

export function LayoutSwitcher() {
  const mode = useAppStore((s) =>
    s.activeGroupId ? s.layoutByGroup[s.activeGroupId]?.mode ?? null : null
  )

  if (!mode) {
    return null
  }

  const setMode = (next: LayoutMode) => {
    const {
      activeGroupId,
      layoutByGroup,
      tabsByGroup,
      activeSessionByGroup,
      setLayout,
    } = useAppStore.getState()
    if (!activeGroupId) return
    const layout = layoutByGroup[activeGroupId]
    if (!layout) return

    let resized = withMode(layout, next)
    // Seed still-empty panes with the open tabs (active first) so a fresh
    // multi-pane layout shows real sessions instead of blank drop zones.
    if (next !== "single") {
      const placed = new Set(resized.panes.filter((id): id is string => !!id))
      const active = activeSessionByGroup[activeGroupId]
      const seen = new Set<string>()
      const queue = [active, ...(tabsByGroup[activeGroupId] ?? [])].filter(
        (id): id is string => !!id && !placed.has(id) && !seen.has(id) && !!seen.add(id)
      )
      resized = {
        ...resized,
        panes: resized.panes.map((p) => p ?? queue.shift() ?? null),
      }
    }
    setLayout(activeGroupId, resized)
  }

  return (
    <ButtonGroup>
      {MODES.map(({ mode: m, label, Icon }) => (
        <Button
          key={m}
          variant="outline"
          size="icon-sm"
          aria-label={label}
          title={label}
          aria-pressed={mode === m}
          onClick={() => setMode(m)}
          className={cn(
            "text-muted-foreground",
            mode === m && "bg-muted text-foreground"
          )}
        >
          <Icon />
        </Button>
      ))}
    </ButtonGroup>
  )
}
