import type { ComponentType, SVGProps } from "react"

import { AnthropicIcon, OpenAIIcon } from "@/components/icons/brand"
import type { Provider } from "@/types"

/** A provider's brand mark, shown wherever an agent's provider is surfaced
 *  (model picker rail, provider settings, agent-session icon). */
export const PROVIDER_ICON: Record<
  Provider,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  claude: AnthropicIcon,
  codex: OpenAIIcon,
}

/** Stable display order for providers. */
export const PROVIDER_ORDER: Provider[] = ["claude", "codex"]
