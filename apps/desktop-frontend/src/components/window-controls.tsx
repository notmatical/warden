import { Copy, Minus, Square, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

async function appWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window")
  return getCurrentWindow()
}

/** Track the window's maximized state so the maximize/restore glyph stays correct. */
function useMaximized(): boolean {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    let active = true
    let unlisten: (() => void) | undefined
    void (async () => {
      const win = await appWindow()
      if (!active) return
      setMaximized(await win.isMaximized())
      unlisten = await win.onResized(async () => {
        setMaximized(await win.isMaximized())
      })
    })()
    return () => {
      active = false
      unlisten?.()
    }
  }, [])
  return maximized
}

const BTN =
  "flex h-full w-[46px] items-center justify-center text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground [&>svg]:size-3.5"

/** Custom window controls for Windows/Linux (native decorations are off there).
 *  Hovering the maximize button briefly surfaces the Win11 Snap Layout overlay
 *  via decorum, so the native snap UX is preserved. */
export function WindowControls() {
  const maximized = useMaximized()
  const snapTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const minimize = async () => (await appWindow()).minimize()
  const toggleMaximize = async () => (await appWindow()).toggleMaximize()
  const close = async () => (await appWindow()).close()

  const showSnapOverlay = async () => {
    const [{ invoke }, win] = await Promise.all([
      import("@tauri-apps/api/core"),
      appWindow(),
    ])
    await win.setFocus()
    await invoke("plugin:decorum|show_snap_overlay").catch(() => {})
  }

  return (
    <div className="flex h-full items-stretch">
      <button
        type="button"
        aria-label="Minimize"
        onClick={() => void minimize()}
        className={BTN}
      >
        <Minus />
      </button>
      <button
        type="button"
        aria-label={maximized ? "Restore" : "Maximize"}
        onClick={() => void toggleMaximize()}
        onMouseEnter={() => {
          snapTimer.current = setTimeout(() => void showSnapOverlay(), 620)
        }}
        onMouseLeave={() => clearTimeout(snapTimer.current)}
        className={BTN}
      >
        {maximized ? <Copy className="-scale-x-100" /> : <Square />}
      </button>
      <button
        type="button"
        aria-label="Close"
        onClick={() => void close()}
        className={cn(BTN, "hover:bg-red-600 hover:text-white")}
      >
        <X />
      </button>
    </div>
  )
}
