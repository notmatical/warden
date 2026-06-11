import { CheckCircle2, Loader2, XCircle } from "lucide-react"

import type { CheckStatus } from "@/types"

/** A PR's CI-check rollup, as a small leading glyph. */
export function CheckGlyph({ status }: { status: CheckStatus | null }) {
  if (status === "pending")
    return <Loader2 className="size-3 animate-spin text-amber-500" />
  if (status === "failure") return <XCircle className="size-3 text-red-500" />
  if (status === "success")
    return <CheckCircle2 className="size-3 text-emerald-500" />
  return null
}
