import { Loader2, SquareTerminal } from "lucide-react"
import {
  AnthropicIcon,
  ClaudeIcon,
  CodexIcon,
  OpenAIIcon,
} from "@/components/icons/brand"
import { cn } from "@/lib/utils"
import type { Backend, SessionKind, SessionStatus } from "@/types"

/**
 * The per-session glyph shared by the tab strip, sidebar, and drag preview.
 * Native CLI terminals (a `terminalCommand` is set) show the product logo
 * (Claude/Codex); plain shell terminals show a generic terminal glyph; agent
 * sessions show the model's provider mark (Anthropic/OpenAI). When a status is
 * given, a running session swaps the glyph for a spinner and an error tints it
 * red.
 */
export function SessionFavicon({
  kind,
  backend,
  status,
  terminalCommand,
  className,
}: {
  kind: SessionKind
  backend: Backend
  status?: SessionStatus
  /** The native CLI a terminal launches; null/undefined for a plain shell. */
  terminalCommand?: string | null
  className?: string
}) {
  if (status === "running") {
    return (
      <Loader2
        className={cn(
          "size-3.5 shrink-0 animate-spin text-amber-500",
          className
        )}
      />
    )
  }

  // A plain shell terminal isn't tied to a provider — show a neutral terminal
  // glyph rather than falling through to the Claude/Codex product logo.
  if (kind === "terminal" && !terminalCommand) {
    return (
      <SquareTerminal
        className={cn(
          "size-3.5 shrink-0",
          status === "error" ? "text-red-500" : "opacity-70",
          className
        )}
      />
    )
  }

  const Brand =
    kind === "terminal"
      ? backend === "codex"
        ? CodexIcon
        : ClaudeIcon
      : backend === "codex"
        ? OpenAIIcon
        : AnthropicIcon
  // The colored terminal logos render full-strength; the monochrome provider
  // marks stay subtle (and tint red on error).
  const colored = kind === "terminal"
  return (
    <Brand
      className={cn(
        "size-3.5 shrink-0",
        colored ? null : status === "error" ? "text-red-500" : "opacity-70",
        className
      )}
    />
  )
}
