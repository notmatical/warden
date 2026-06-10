import {
  currentMonitor,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
  type Monitor,
  primaryMonitor,
} from "@tauri-apps/api/window"

export const WINDOW_WIDTH = 372
const EDGE_MARGIN = 8

/** Anchor the (already content-sized) window to the bottom-right of the work
 *  area — the same corner the OS uses for its own toasts. */
export async function placeWindow(heightLogical: number): Promise<void> {
  const win = getCurrentWindow()
  let monitor: Monitor | null = null
  try {
    monitor = (await primaryMonitor()) ?? (await currentMonitor())
  } catch {
    monitor = null
  }
  await win.setSize(new LogicalSize(WINDOW_WIDTH, heightLogical))
  if (monitor) {
    const scale = monitor.scaleFactor
    const right =
      (monitor.workArea.position.x + monitor.workArea.size.width) / scale
    const bottom =
      (monitor.workArea.position.y + monitor.workArea.size.height) / scale
    await win.setPosition(
      new LogicalPosition(
        right - WINDOW_WIDTH - EDGE_MARGIN,
        bottom - heightLogical - EDGE_MARGIN
      )
    )
  }
}
