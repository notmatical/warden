import type { Layout, LayoutMode } from "@/types"

/** Number of panes each layout mode renders. */
export const PANE_COUNT: Record<LayoutMode, number> = {
  single: 1,
  "split-2": 2,
  "grid-4": 4,
}

export const DEFAULT_LAYOUT: Layout = { mode: "single", panes: [null] }

const MODES: LayoutMode[] = ["single", "split-2", "grid-4"]

/** Coerce a panes array to exactly `count` cells (pad with null / truncate). */
function fitPanes(panes: (string | null)[], count: number): (string | null)[] {
  const next = panes.slice(0, count)
  while (next.length < count) next.push(null)
  return next
}

/** Parse a group's stored layout JSON, tolerating malformed/legacy values. */
export function parseLayout(raw: string): Layout {
  try {
    const parsed = JSON.parse(raw) as Partial<Layout>
    const mode = MODES.includes(parsed.mode as LayoutMode)
      ? (parsed.mode as LayoutMode)
      : "single"
    const panes = Array.isArray(parsed.panes) ? parsed.panes : []
    return { mode, panes: fitPanes(panes, PANE_COUNT[mode]) }
  } catch {
    return { ...DEFAULT_LAYOUT }
  }
}

export function serializeLayout(layout: Layout): string {
  return JSON.stringify(layout)
}

/** Switch grid mode, preserving as many pane assignments as still fit. */
export function withMode(layout: Layout, mode: LayoutMode): Layout {
  return { mode, panes: fitPanes(layout.panes, PANE_COUNT[mode]) }
}

/** Place a session in a pane, removing it from any other pane it occupied. */
export function assignPane(
  layout: Layout,
  index: number,
  sessionId: string
): Layout {
  const panes = layout.panes.map((s) => (s === sessionId ? null : s))
  panes[index] = sessionId
  return { ...layout, panes }
}

/** Clear a pane. */
export function clearPane(layout: Layout, index: number): Layout {
  const panes = layout.panes.slice()
  panes[index] = null
  return { ...layout, panes }
}

/** Remove a session from whatever pane holds it (on close/delete). */
export function detachSession(layout: Layout, sessionId: string): Layout {
  if (!layout.panes.includes(sessionId)) return layout
  return { ...layout, panes: layout.panes.map((s) => (s === sessionId ? null : s)) }
}
