import modelConfig from "@/config/models.json"
import type { Backend, EffortLevel } from "@/types"

export interface ModelOption {
  id: string
  label: string
  /** Display grouping (vendor name). The {@link Backend} that runs the model
   *  is derived from its id by {@link backendForModel}. */
  provider: string
}

/**
 * Selectable models, grouped by provider, from the shared models config
 * (src/config/models.json — also read by the Rust backend). Standard-context
 * models come first and are the defaults; the `[1m]` suffix enables the
 * 1M-token context window (which requires paid usage credits), so those are
 * explicit opt-ins. The fast service tier is a per-model toggle (see
 * {@link withFast}), not a list entry.
 */
export const MODELS: ModelOption[] = modelConfig.models

/**
 * The agent backend that runs a model id, mirroring the backend's own rule
 * (`opencode/...` ids → OpenCode; `gpt`/`codex` prefixes → Codex; everything
 * else → Claude). Keep this in sync with `Backend::for_model` in
 * src-tauri/src/domain/session.rs.
 */
export function backendForModel(id: string): Backend {
  const lower = baseModelId(id).toLowerCase()
  if (lower.startsWith("opencode")) return "opencode"
  return lower.startsWith("gpt") || lower.startsWith("codex")
    ? "codex"
    : "claude"
}

/** Each backend's provider display name, for picker grouping of models that
 *  aren't in the static list (dynamic OpenCode entries, resumed sessions on
 *  retired ids). */
export const BACKEND_PROVIDER_NAME: Record<Backend, string> = {
  claude: "Anthropic",
  codex: "OpenAI",
  opencode: "OpenCode",
}

/** Provider rail entries for a picker model list: display names in first-seen
 *  order, each tagged with the backend its models run on. */
export function providerEntries(
  models: ModelOption[]
): { name: string; backend: Backend }[] {
  const names = [...new Set(models.map((m) => m.provider))]
  return names.map((name) => {
    const id = models.find((m) => m.provider === name)?.id
    return { name, backend: id ? backendForModel(id) : "claude" }
  })
}

const FAST_SUFFIX = "-fast"

/**
 * Base model id → its fast (priority service tier) variant. Fast is a per-model
 * service tier exposed via the picker's toggle, not a standalone list entry.
 * Codex tags its fast tier with the same `-fast` suffix the backend expects.
 */
const FAST_VARIANTS: Record<string, string> = modelConfig.fastVariants

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

export const DEFAULT_CHAT_MODEL = modelConfig.defaults.chat
export const DEFAULT_PLANNER_MODEL = modelConfig.defaults.planner
export const DEFAULT_CODER_MODEL = modelConfig.defaults.coder
/** Default model shown for Codex sessions (Codex's current default). */
export const DEFAULT_CODEX_MODEL = modelConfig.defaults.codexChat
/** Default model shown for OpenCode sessions. */
export const DEFAULT_OPENCODE_MODEL = modelConfig.defaults.opencodeChat

/** Each backend's default chat model — what a new session of that provider
 *  starts on. */
export const DEFAULT_MODEL_BY_BACKEND: Record<Backend, string> = {
  claude: DEFAULT_CHAT_MODEL,
  codex: DEFAULT_CODEX_MODEL,
  opencode: DEFAULT_OPENCODE_MODEL,
}

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

  // Dynamic OpenCode ids carry a provider path (`opencode/anthropic/<model>`);
  // the model segment is the readable part.
  if (base.includes("/")) {
    base = base.split("/").pop() ?? base
  }

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
