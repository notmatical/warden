import type { ComponentType, SVGProps } from "react"

import {
  AnthropicIcon,
  ClaudeIcon,
  CodexIcon,
  CursorIcon,
  GrokIcon,
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
  cursor: CursorIcon,
  grok: GrokIcon,
}

/** A provider's product mark, shown where the agent itself is surfaced
 *  (native CLI terminals, session favicons, model picker value, agent icon). */
export const PRODUCT_ICON: Record<
  Provider,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  claude: ClaudeIcon,
  codex: CodexIcon,
  opencode: OpenCodeIcon,
  cursor: CursorIcon,
  grok: GrokIcon,
}

/** Stable display order for providers. */
export const PROVIDER_ORDER: Provider[] = [
  "claude",
  "codex",
  "opencode",
  "cursor",
  "grok",
]
