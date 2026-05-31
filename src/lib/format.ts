export function formatCost(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "$0.00"
  }

  const decimals = value < 0.01 ? 4 : value < 1 ? 3 : 2
  return `$${value.toFixed(decimals)}`
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) {
    return "—"
  }

  if (ms < 1000) {
    return `${Math.round(ms)}ms`
  }

  const seconds = ms / 1000
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  }

  const minutes = Math.floor(seconds / 60)
  const remainder = Math.round(seconds % 60)
  return `${minutes}m ${remainder}s`
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) {
    return ""
  }

  const diff = Date.now() - then
  const abs = Math.abs(diff)
  const suffix = diff >= 0 ? "ago" : "from now"

  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (abs < minute) {
    return "just now"
  }
  if (abs < hour) {
    const m = Math.round(abs / minute)
    return `${m}m ${suffix}`
  }
  if (abs < day) {
    const h = Math.round(abs / hour)
    return `${h}h ${suffix}`
  }
  if (abs < 30 * day) {
    const d = Math.round(abs / day)
    return `${d}d ${suffix}`
  }

  return new Date(iso).toLocaleDateString()
}
