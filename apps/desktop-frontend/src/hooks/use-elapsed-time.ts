import { useEffect, useState } from "react"

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds}s`
}

/**
 * A live "elapsed since `startedAt`" string (e.g. "23s") that ticks each
 * second. Returns null when `startedAt` is null. Time is read in an interval,
 * never during render.
 */
export function useElapsedTime(startedAt: number | null): string | null {
  const [elapsed, setElapsed] = useState<number | null>(null)

  useEffect(() => {
    if (startedAt == null) {
      setElapsed(null)
      return
    }
    setElapsed(Date.now() - startedAt)
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 1000)
    return () => clearInterval(id)
  }, [startedAt])

  return elapsed == null ? null : formatElapsed(elapsed)
}
