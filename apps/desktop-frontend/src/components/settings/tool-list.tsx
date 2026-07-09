import type { ReactNode } from "react"

/** One bordered container for a section's setting rows — the settings-list
 *  pattern (one surface, hairline-divided rows) used by the Notifications
 *  section. Providers and Integrations use the card grid instead. */
export function ToolList({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border/50 overflow-hidden rounded-xl bg-card shadow-xs ring-1 ring-foreground/10">
      {children}
    </div>
  )
}
