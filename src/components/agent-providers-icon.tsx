import { Sparkles } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { PRODUCT_ICON, PROVIDER_ORDER } from "@/lib/provider-icons"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"

/** Icon for a generic agent session: the product mark of the provider you're
 *  signed into, gently rotating through them when more than one is enabled.
 *  Falls back to a spark when no provider is authed. */
export function AgentProvidersIcon({ className }: { className?: string }) {
  const providers = useAppStore((s) => s.providers)
  const enabled = useMemo(
    () =>
      PROVIDER_ORDER.filter((p) =>
        providers.some((entry) => entry.id === p && entry.authed)
      ),
    [providers]
  )
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (enabled.length < 2) return
    const id = setInterval(
      () => setIndex((i) => (i + 1) % enabled.length),
      2200
    )
    return () => clearInterval(id)
  }, [enabled.length])

  if (enabled.length === 0) return <Sparkles className={className} />

  const provider = enabled[index % enabled.length]
  const Icon = PRODUCT_ICON[provider]
  // Remount on swap so the fade-in replays.
  return (
    <Icon
      key={provider}
      className={cn("animate-in fade-in zoom-in-95 duration-300", className)}
    />
  )
}
