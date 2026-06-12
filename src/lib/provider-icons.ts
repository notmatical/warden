import type { ComponentType, SVGProps } from "react"

import {
  AnthropicIcon,
  ClaudeIcon,
  CodexIcon,
  OpenAIIcon,
  OpenCodeIcon,
} from "@/components/icons/brand"
import type { Provider } from "@/types"

/** A provider's brand mark, shown wherever an agent's provider is surfaced
 *  (model picker rail, provider settings, agent-session icon). */
export const PROVIDER_ICON: Record<
  Provider,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  claude: AnthropicIcon,
  codex: OpenAIIcon,
  opencode: OpenCodeIcon,
}

/** The product mark for a provider's native CLI terminal sessions. */
export const NATIVE_PROVIDER_ICON: Record<
  Provider,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  claude: ClaudeIcon,
  codex: CodexIcon,
  opencode: OpenCodeIcon,
}

/** Stable display order for providers. */
export const PROVIDER_ORDER: Provider[] = ["claude", "codex", "opencode"]
