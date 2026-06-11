import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const INTERVAL = 80

/** A monospace braille-dot spinner — a lighter, more distinctive alternative to a
 *  rotating icon. Cycles 10 frames at 80ms; holds a static frame when the user
 *  prefers reduced motion. */
export function BrailleSpinner({ className }: { className?: string }) {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const id = setInterval(
      () => setFrame((f) => (f + 1) % FRAMES.length),
      INTERVAL
    )
    return () => clearInterval(id)
  }, [])

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex items-center justify-center select-none font-mono text-sm leading-none text-primary",
        className
      )}
    >
      {FRAMES[frame]}
    </span>
  )
}
