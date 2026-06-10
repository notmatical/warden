import { Boxes, type LucideIcon, Plug2 } from "lucide-react"
import type { ComponentType } from "react"

import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"
import { IntegrationsSection } from "./sections/integrations-section"
import { ProvidersSection } from "./sections/providers-section"

interface Section {
  id: string
  label: string
  icon: LucideIcon
  Component: ComponentType
}

// Add a pane by appending here — the nav and content router are data-driven.
const SECTIONS: Section[] = [
  {
    id: "providers",
    label: "Providers",
    icon: Boxes,
    Component: ProvidersSection,
  },
  {
    id: "integrations",
    label: "Integrations",
    icon: Plug2,
    Component: IntegrationsSection,
  },
]

/** The Settings tab body — the same nav + content the old dialog had, sized to
 *  fill the pane instead of a fixed modal. The "active section" lives in the
 *  store (`settingsSection`) so the user's last-viewed section is restored when
 *  they reopen the tab and so `openSettings("integrations")` works as a deep
 *  link from anywhere. */
export function SettingsPanel() {
  const active = useAppStore((s) => s.settingsSection)
  const setActive = useAppStore((s) => s.setSettingsSection)

  const Active =
    SECTIONS.find((s) => s.id === active)?.Component ?? ProvidersSection

  // Settings is already labeled by the tab strip + pane header, so the panel
  // drops its own "Settings" heading and any chrome that competes with the
  // real sidebar to its left. Nav buttons float in the same surface as the
  // content — a preferences-style layout (macOS System Settings, Linear,
  // Vercel) rather than a panel-in-a-panel.
  return (
    <div className="grid h-full min-h-0 grid-cols-[200px_1fr]">
      <nav className="flex flex-col gap-0.5 border-border/40 border-r p-3">
        {SECTIONS.map((section) => {
          const Icon = section.icon
          const isActive = section.id === active
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => setActive(section.id)}
              className={cn(
                "relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors",
                isActive
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              <Icon
                className={cn(
                  "size-4 shrink-0",
                  isActive ? "text-foreground" : "text-muted-foreground/70"
                )}
              />
              {section.label}
            </button>
          )
        })}
      </nav>
      <div className="min-w-0 overflow-y-auto px-8 py-6">
        <Active />
      </div>
    </div>
  )
}
