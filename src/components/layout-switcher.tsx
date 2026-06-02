import { Columns2, Grid2x2, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { withMode } from "@/lib/layout"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"
import type { LayoutMode } from "@/types"

const MODES: { mode: LayoutMode; label: string; Icon: typeof Square }[] = [
  { mode: "single", label: "Single pane", Icon: Square },
  { mode: "split-2", label: "Split two", Icon: Columns2 },
  { mode: "grid-4", label: "Grid four", Icon: Grid2x2 },
]

export function LayoutSwitcher() {
  const mode = useAppStore((s) =>
    s.activeGroupId ? s.layoutByGroup[s.activeGroupId]?.mode ?? null : null
  )

  if (!mode) {
    return null
  }

  const setMode = (next: LayoutMode) => {
    const { activeGroupId, layoutByGroup, setLayout } = useAppStore.getState()
    if (!activeGroupId) return
    const layout = layoutByGroup[activeGroupId]
    if (!layout) return
    setLayout(activeGroupId, withMode(layout, next))
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
