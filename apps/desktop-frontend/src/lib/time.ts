import {
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  differenceInSeconds,
  format,
} from "date-fns"

/** Compact humanized timestamp: "just now", "6m ago", "3h ago", "2d ago", or a
 *  short date for anything older than a week. */
export function relativeTime(iso: string): string {
  const date = new Date(iso)
  const now = Date.now()
  const seconds = differenceInSeconds(now, date)
  if (seconds < 45) return "just now"
  const minutes = differenceInMinutes(now, date)
  if (minutes < 60) return `${minutes}m ago`
  const hours = differenceInHours(now, date)
  if (hours < 24) return `${hours}h ago`
  const days = differenceInDays(now, date)
  if (days < 7) return `${days}d ago`
  return format(date, "MMM d")
}

/** Short date for table rows: "Jun 9". Empty string for invalid input. */
export function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? "" : format(date, "MMM d")
}

/** Full local timestamp for hover tooltips: "Jun 9, 2026 at 4:12 PM". */
export function formatExact(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ""
    : format(date, "MMM d, yyyy 'at' h:mm a")
}

/** Compact elapsed time between two ISO timestamps: "<1s", "8s", "2m 5s". */
export function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  if (!Number.isFinite(ms) || ms < 1000) return "<1s"
  const total = Math.round(ms / 1000)
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`
}
