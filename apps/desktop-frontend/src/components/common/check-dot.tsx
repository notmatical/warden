import { cn } from "@/lib/utils"
import type { CheckStatus } from "@/types"

/** A PR's CI-check rollup as a small status dot: running amber (pulsing),
 *  failing red, passing green. Renders nothing when the PR has no checks. */
export function CheckDot({
  status,
  className,
}: {
  status: CheckStatus | null
  className?: string
}) {
  if (!status) return null
  const tone =
    status === "pending"
      ? "animate-pulse bg-amber-500"
      : status === "failure"
        ? "bg-red-500"
        : "bg-emerald-500"
  return (
    <span
      className={cn("size-2 shrink-0 rounded-full", tone, className)}
      role="img"
      aria-label={`Checks ${status}`}
    />
  )
}
