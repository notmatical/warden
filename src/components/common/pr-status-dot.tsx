import { cn } from "@/lib/utils"
import type { CheckStatus } from "@/types"

/** One dot encoding a PR's state and CI rollup: merged violet, closed red,
 *  then the open PR's checks — failing red, running amber (pulsing), else
 *  green. */
export function PrStatusDot({
  state,
  checkStatus,
  className,
}: {
  state: string | null
  checkStatus: CheckStatus | null
  className?: string
}) {
  const open = state !== "MERGED" && state !== "CLOSED"
  const running = open && checkStatus === "pending"
  const tone =
    state === "MERGED"
      ? "bg-violet-500"
      : state === "CLOSED"
        ? "bg-red-500"
        : checkStatus === "failure"
          ? "bg-red-500"
          : running
            ? "bg-amber-500"
            : "bg-emerald-500"
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        tone,
        running && "animate-pulse",
        className
      )}
    />
  )
}
