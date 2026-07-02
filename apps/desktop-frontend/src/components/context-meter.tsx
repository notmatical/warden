import { useMemo } from "react"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { contextUsed, contextWindow, latestUsage } from "@/lib/context-usage"
import { formatCompact } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"

/** A thin progress ring, filled clockwise from the top. */
function Ring({ pct, tone }: { pct: number; tone: string }) {
  const size = 18
  const stroke = 2.5
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, pct))
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="-rotate-90"
      aria-hidden
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        stroke="currentColor"
        className="text-muted-foreground/20"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        stroke="currentColor"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - clamped)}
        className={cn("transition-[stroke-dashoffset] duration-500", tone)}
      />
    </svg>
  )
}

/** Context-window fill gauge for the active session's model. A ring + percent in
 *  the composer toolbar; clicking opens a token/cost breakdown. Hidden until the
 *  first turn reports usage. */
export function ContextMeter({ sessionId }: { sessionId: string }) {
  const model = useAppStore((s) => s.sessions[sessionId]?.model)
  const costUsd = useAppStore((s) => s.sessions[sessionId]?.costUsd ?? 0)
  const events = useAppStore((s) => s.eventsBySession[sessionId])
  const usage = useMemo(() => latestUsage(events), [events])

  if (!model || !usage) return null

  const used = contextUsed(usage)
  const max = contextWindow(model)
  const pct = used / max
  const pctLabel = Math.round(pct * 100)
  const tone =
    pct > 0.9 ? "text-red-500" : pct > 0.7 ? "text-amber-500" : "text-primary"
  const barTone =
    pct > 0.9 ? "bg-red-500" : pct > 0.7 ? "bg-amber-500" : "bg-primary"

  const rows: [string, number][] = [
    ["Input", usage.input_tokens],
    ["Output", usage.output_tokens],
    ["Cache read", usage.cache_read_input_tokens],
    ["Cache write", usage.cache_creation_input_tokens],
  ]

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Context window"
              className="flex items-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <Ring pct={pct} tone={tone} />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          Context {formatCompact(used)} / {formatCompact(max)} ({pctLabel}%)
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="top" align="end" className="w-72 p-0">
        <div className="flex items-center justify-between border-b border-border/60 px-3.5 py-2.5">
          <span className="text-sm font-medium text-foreground">Context</span>
          <span
            className="max-w-40 truncate font-mono text-xs text-muted-foreground"
            title={model}
          >
            {model}
          </span>
        </div>
        <div className="px-3.5 py-3">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-foreground tabular-nums">
              <span className="text-lg font-semibold">
                {formatCompact(used)}
              </span>
              <span className="text-sm text-muted-foreground">
                {" "}
                / {formatCompact(max)}
              </span>
            </span>
            <span className={cn("text-sm font-semibold tabular-nums", tone)}>
              {pctLabel}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500",
                barTone
              )}
              style={{ width: `${Math.min(100, pctLabel)}%` }}
            />
          </div>
          <div className="mt-3.5 flex flex-col gap-2">
            {rows.map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between text-[13px]"
              >
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium text-foreground/90 tabular-nums">
                  {formatCompact(value)}
                </span>
              </div>
            ))}
            <div className="mt-1 flex items-center justify-between border-t border-border/60 pt-2.5 text-[13px]">
              <span className="text-muted-foreground">Session cost</span>
              <span className="font-medium text-foreground/90 tabular-nums">
                ${costUsd.toFixed(costUsd < 1 ? 4 : 2)}
              </span>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
