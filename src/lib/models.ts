import type { Backend, EffortLevel } from "@/types"

export interface ModelOption {
  id: string
  label: string
  /** Display grouping (vendor name). The {@link Backend} that runs the model
   *  is derived from its id by {@link backendForModel}. */
  provider: string
}

/**
 * Selectable models, grouped by provider. Standard-context models come first
 * and are the defaults; the `[1m]` suffix enables the 1M-token context window
 * (which requires paid usage credits), so those are explicit opt-ins. The fast
 * service tier is a per-model toggle (see {@link withFast}), not a list entry.
 */
export const MODELS: ModelOption[] = [
  { id: "claude-opus-4-8", label: "Opus 4.8", provider: "Anthropic" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", provider: "Anthropic" },
  { id: "haiku", label: "Haiku", provider: "Anthropic" },
  { id: "claude-opus-4-8[1m]", label: "Opus 4.8 (1M)", provider: "Anthropic" },
  { id: "claude-sonnet-4-6[1m]", label: "Sonnet 4.6 (1M)", provider: "Anthropic" },
  { id: "gpt-5.1-codex", label: "GPT-5.1 Codex", provider: "OpenAI" },
  { id: "gpt-5.5", label: "GPT-5.5", provider: "OpenAI" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", provider: "OpenAI" },
]

/**
 * The agent backend that runs a model id, mirroring the backend's own rule
 * (`gpt`/`codex` prefixes → Codex; everything else → Claude). Keep this in
 * sync with `backend_for_model` in src-tauri/src/commands/session.rs.
 */
export function backendForModel(id: string): Backend {
  const lower = baseModelId(id).toLowerCase()
  return lower.startsWith("gpt") || lower.startsWith("codex")
    ? "codex"
    : "claude"
}

/** Provider display names in first-seen order, for grouping in the picker. */
export const MODEL_PROVIDERS: string[] = [
  ...new Set(MODELS.map((m) => m.provider)),
]

const FAST_SUFFIX = "-fast"

/** Base model id → its fast (priority service tier) variant. */
const FAST_VARIANTS: Record<string, string> = {
  "claude-opus-4-8[1m]": `claude-opus-4-8[1m]${FAST_SUFFIX}`,
}

/** Whether a model id selects the fast service tier. */
export function isFastModel(id: string): boolean {
  return id.endsWith(FAST_SUFFIX)
}

/** The id with any fast suffix stripped. */
export function baseModelId(id: string): string {
  return isFastModel(id) ? id.slice(0, -FAST_SUFFIX.length) : id
}

/** Whether a model has a fast variant available. */
export function supportsFast(id: string): boolean {
  return baseModelId(id) in FAST_VARIANTS
}

/** Toggle the fast tier on a model id, returning the appropriate variant. */
export function withFast(id: string, fast: boolean): string {
  const base = baseModelId(id)
  return fast && base in FAST_VARIANTS ? FAST_VARIANTS[base] : base
}

export const DEFAULT_CHAT_MODEL = "claude-opus-4-8"
export const DEFAULT_PLANNER_MODEL = "claude-sonnet-4-6"
export const DEFAULT_CODER_MODEL = "claude-opus-4-8"
/** Placeholder model for Codex sessions; the backend uses Codex's own default. */
export const DEFAULT_CODEX_MODEL = "gpt-5.1-codex"

const MODEL_ALIASES: Record<string, string> = {
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
}

/**
 * Render a model id as a clean display name. The fast tier is shown separately
 * (a ⚡ glyph), so it's stripped here. Known models use their label; unknown ids
 * are parsed from their shape — `claude-opus-4-8[1m]` → "Opus 4.8 (1M)" — so
 * resumed sessions never show a raw id.
 */
export function formatModelName(id: string): string {
  if (!id) return "Model"

  let base = baseModelId(id)
  const known = MODELS.find((m) => m.id === base)
  if (known) return known.label

  let suffix = ""
  if (base.includes("[1m]")) {
    suffix = ` (1M)${suffix}`
    base = base.replace("[1m]", "")
  }

  if (base in MODEL_ALIASES) {
    return `${MODEL_ALIASES[base]}${suffix}`
  }

  const match = base.match(/(opus|sonnet|haiku)-(\d+)-(\d+)/i)
  if (match) {
    const family = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase()
    return `${family} ${match[2]}.${match[3]}${suffix}`
  }

  return base
}

export interface EffortOption {
  value: EffortLevel
  label: string
}

export const EFFORT_OPTIONS: EffortOption[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "xHigh" },
  { value: "max", label: "Max" },
]

export function effortLabel(value: EffortLevel): string {
  return EFFORT_OPTIONS.find((o) => o.value === value)?.label ?? value
}
