import { useCallback, type PointerEvent as ReactPointerEvent } from "react"

import { useAppStore } from "@/store/app-store"

/** A drag handle on the sidebar's right edge that adjusts its width. The width
 *  is clamped + persisted in the store; sitting at `--sidebar-width` keeps it on
 *  the sidebar/content boundary. */
export function SidebarResizer() {
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth)

  const onPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      event.preventDefault()
      const move = (e: PointerEvent) => setSidebarWidth(e.clientX)
      const up = () => {
        window.removeEventListener("pointermove", move)
        window.removeEventListener("pointerup", up)
        document.body.style.removeProperty("cursor")
        document.body.style.removeProperty("user-select")
      }
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
      window.addEventListener("pointermove", move)
      window.addEventListener("pointerup", up)
    },
    [setSidebarWidth]
  )

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      onPointerDown={onPointerDown}
      style={{ left: "var(--sidebar-width)" }}
      className="absolute inset-y-0 z-20 w-1.5 -translate-x-1/2 cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors hover:after:bg-sidebar-border"
    />
  )
}
