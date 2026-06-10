import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react"
import {
  MAIN_WINDOW,
  NOTIFY_ACTIVATED,
  NOTIFY_PING,
  NOTIFY_PONG,
  NOTIFY_SHOW,
  type ToastPayload,
} from "@/lib/notify"
import { placeWindow } from "./placement"
import { type Toast, ToastCard } from "./toast-card"

const TOAST_DURATION_MS = 7_000
const LEAVE_MS = 160
const MAX_STACK = 4

export function ToastWindow() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const hoverStartRef = useRef<number | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const lastHeightRef = useRef(0)

  const dismiss = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, leaving: true } : t))
    )
    setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      LEAVE_MS
    )
  }, [])

  // Wire the cross-window events: handshake pings and incoming toasts.
  useEffect(() => {
    const unlisteners: Promise<UnlistenFn>[] = [
      listen(NOTIFY_PING, () => {
        void emitTo(MAIN_WINDOW, NOTIFY_PONG).catch(() => {})
      }),
      listen<ToastPayload>(NOTIFY_SHOW, ({ payload }) => {
        setToasts((prev) => {
          const next = [
            ...prev,
            { ...payload, shownAt: Date.now(), leaving: false },
          ]
          // Cap the stack; quietly drop the oldest survivors.
          return next.slice(Math.max(0, next.length - MAX_STACK))
        })
      }),
    ]
    return () => {
      for (const p of unlisteners) void p.then((un) => un())
    }
  }, [])

  // Age out toasts. Expiry pauses while hovered: the tick skips, and on
  // mouse-leave every deadline slides forward by the hover duration.
  useEffect(() => {
    const tick = setInterval(() => {
      if (hoverStartRef.current !== null) return
      const now = Date.now()
      setToasts((prev) => {
        const expired = prev.filter(
          (t) => !t.leaving && now - t.shownAt > TOAST_DURATION_MS
        )
        for (const t of expired) dismiss(t.id)
        return prev
      })
    }, 250)
    return () => clearInterval(tick)
  }, [dismiss])

  // Resize the window to its content and show/hide with the stack. An effect
  // event so the mount-once ResizeObserver always reads the live stack size.
  const syncWindow = useEffectEvent(() => {
    const el = contentRef.current
    if (!el) return
    const win = getCurrentWindow()
    if (toasts.length === 0) {
      void win.hide().catch(() => {})
      lastHeightRef.current = 0
      return
    }
    const height = Math.ceil(el.getBoundingClientRect().height)
    if (height === lastHeightRef.current) return
    lastHeightRef.current = height
    void placeWindow(height)
      .then(() => win.show())
      .catch(() => {})
  })

  // Every stack change that matters alters the container's height (including
  // shrinking to zero), so the observer alone drives placement + show/hide.
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const observer = new ResizeObserver(() => syncWindow())
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const activate = useCallback(
    async (toast: Toast) => {
      dismiss(toast.id)
      try {
        await emitTo(MAIN_WINDOW, NOTIFY_ACTIVATED, toast)
        const main = await WebviewWindow.getByLabel(MAIN_WINDOW)
        await main?.unminimize()
        await main?.setFocus()
      } catch {
        // The main window handles navigation; focus is best-effort.
      }
    },
    [dismiss]
  )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover only pauses expiry — no action
    <div
      ref={contentRef}
      className="flex flex-col gap-2 px-3 py-2"
      onMouseEnter={() => {
        hoverStartRef.current = Date.now()
      }}
      onMouseLeave={() => {
        const start = hoverStartRef.current
        hoverStartRef.current = null
        if (start === null) return
        const pausedFor = Date.now() - start
        setToasts((prev) =>
          prev.map((t) => ({ ...t, shownAt: t.shownAt + pausedFor }))
        )
      }}
    >
      {toasts.map((toast) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          onActivate={(t) => void activate(t)}
          onDismiss={dismiss}
        />
      ))}
    </div>
  )
}
