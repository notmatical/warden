import { useState } from "react"
import { ChevronRight, Wrench } from "lucide-react"

import { cn } from "@/lib/utils"

function prettyInput(input: unknown): string {
  if (input === null || input === undefined) {
    return ""
  }
  if (typeof input === "string") {
    return input
  }
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

export function ToolCall({ name, input }: { name: string; input: unknown }) {
  const [open, setOpen] = useState(false)
  const pretty = prettyInput(input)
  const hasInput = pretty.length > 0

  return (
    <div className="rounded-sm border border-border/70 bg-muted/40 text-xs">
      <button
        type="button"
        onClick={() => hasInput && setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left font-medium",
          hasInput ? "cursor-pointer" : "cursor-default"
        )}
        aria-expanded={open}
      >
        <Wrench className="size-3.5 text-muted-foreground" />
        <span className="font-mono">{name}</span>
        {hasInput && (
          <ChevronRight
            className={cn(
              "ml-auto size-3.5 text-muted-foreground transition-transform",
              open && "rotate-90"
            )}
          />
        )}
      </button>
      {open && hasInput && (
        <pre className="overflow-x-auto border-t border-border/70 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {pretty}
        </pre>
      )}
    </div>
  )
}
