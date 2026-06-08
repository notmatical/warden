import { cva, type VariantProps } from "class-variance-authority"
import { CircleAlert, Info, TriangleAlert } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

const calloutVariants = cva("flex gap-2.5 rounded-lg p-2.5 text-xs/relaxed", {
  variants: {
    variant: {
      info: "bg-muted/50 text-muted-foreground",
      warning: "bg-amber-500/10 text-amber-500 dark:text-amber-400",
      destructive: "bg-destructive/10 text-destructive",
    },
  },
  defaultVariants: {
    variant: "info",
  },
})

const ICON_MAP = {
  info: Info,
  warning: TriangleAlert,
  destructive: CircleAlert,
} as const

interface CalloutProps extends VariantProps<typeof calloutVariants> {
  children: ReactNode
  className?: string
}

function Callout({ variant = "info", children, className }: CalloutProps) {
  const Icon = ICON_MAP[variant ?? "info"]

  return (
    <div className={cn(calloutVariants({ variant }), className)} role="alert">
      <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  )
}

export { Callout }
