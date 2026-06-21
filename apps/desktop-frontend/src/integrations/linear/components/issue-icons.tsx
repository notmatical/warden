import { cn } from "@/lib/utils"

/** A Linear-style workflow-state glyph, keyed off the state category and tinted
 *  with the state's own color. Approximates Linear's circular progress marks:
 *  dashed (backlog), ring (unstarted), half-pie (started), check (completed),
 *  cross (canceled). */
export function StatusIcon({
  type,
  color,
  className,
}: {
  type: string
  color: string
  className?: string
}) {
  const c = color || "currentColor"
  const cls = cn("size-3.5 shrink-0", className)

  switch (type) {
    case "completed":
      return (
        <svg viewBox="0 0 16 16" className={cls} aria-hidden="true">
          <circle cx="8" cy="8" r="6" fill={c} />
          <path
            d="M5.25 8 7 9.75 10.75 6"
            fill="none"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case "canceled":
      return (
        <svg viewBox="0 0 16 16" className={cls} aria-hidden="true">
          <circle cx="8" cy="8" r="6" fill={c} />
          <path
            d="M6 6 10 10 M10 6 6 10"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )
    case "started":
      return (
        <svg viewBox="0 0 16 16" className={cls} aria-hidden="true">
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke={c}
            strokeWidth="1.5"
          />
          {/* A thick half-length arc on a small radius reads as a half-filled pie. */}
          <circle
            cx="8"
            cy="8"
            r="3"
            fill="none"
            stroke={c}
            strokeWidth="6"
            strokeDasharray="9.42 18.85"
            transform="rotate(-90 8 8)"
          />
        </svg>
      )
    case "backlog":
      return (
        <svg viewBox="0 0 16 16" className={cls} aria-hidden="true">
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke={c}
            strokeWidth="1.5"
            strokeDasharray="2 2"
            strokeOpacity="0.7"
          />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 16 16" className={cls} aria-hidden="true">
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke={c}
            strokeWidth="1.5"
          />
        </svg>
      )
  }
}

// Bar heights for the low/medium/high priority glyph (Linear-style ascending bars).
const BARS = [
  { x: 2.5, h: 5 },
  { x: 6.5, h: 8 },
  { x: 10.5, h: 11 },
]

/** Linear-style priority glyph: an orange alert for urgent, ascending bars for
 *  high/medium/low (filled count = level), faint bars for none. */
export function PriorityIcon({
  priority,
  className,
}: {
  priority: number
  className?: string
}) {
  const cls = cn("size-3.5 shrink-0", className)

  if (priority === 1) {
    return (
      <svg viewBox="0 0 16 16" className={cls} aria-hidden="true">
        <rect x="1" y="1" width="14" height="14" rx="3.5" fill="#f5a623" />
        <rect x="7" y="4" width="2" height="5" rx="1" fill="white" />
        <rect x="7" y="10.5" width="2" height="2" rx="1" fill="white" />
      </svg>
    )
  }

  // 2 high → 3 bars, 3 medium → 2, 4 low → 1, 0 none → 0.
  const filled =
    priority === 2 ? 3 : priority === 3 ? 2 : priority === 4 ? 1 : 0
  return (
    <svg viewBox="0 0 16 16" className={cls} aria-hidden="true">
      {BARS.map((b, i) => (
        <rect
          key={b.x}
          x={b.x}
          y={14 - b.h}
          width="3"
          height={b.h}
          rx="1"
          fill="currentColor"
          fillOpacity={i < filled ? 1 : 0.3}
        />
      ))}
    </svg>
  )
}
