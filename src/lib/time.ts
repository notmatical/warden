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
