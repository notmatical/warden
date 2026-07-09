import { useSyncExternalStore } from "react"

import {
  type CatalogModel,
  getModelCatalog,
  subscribeModelCatalog,
} from "@/lib/model-catalog"
import type { Backend, EffortLevel } from "@/types"

/** A picker entry. Alias of the catalog model shape — the catalog (bundled or
 *  remotely refreshed, see src/lib/model-catalog.ts) is the source of truth. */
export type ModelOption = CatalogModel

/**
 * Selectable models, grouped by provider. Standard-context models come first
 * and are the defaults; the `[1m]` suffix enables the 1M-token context window
 * (which requires paid usage credits), so those are explicit opt-ins. The fast
 * service tier is a per-model toggle (see {@link withFast}), not a list entry.
 * Hidden models are excluded; deprecated ones sort last within the list.
 */
export function getModels(): ModelOption[] {
  const visible = getModelCatalog().models.filter((m) => !m.hidden)
  return [
    ...visible.filter((m) => !m.deprecated),
    ...visible.filter((m) => m.deprecated),
  ]
}

// Memoized per snapshot so useSyncExternalStore subscribers don't re-render on
// every store notification with a fresh array identity.
let modelsSnapshot: { source: CatalogModel[]; models: ModelOption[] } | null =
  null

function getModelsCached(): ModelOption[] {
  const source = getModelCatalog().models
  if (modelsSnapshot?.source !== source) {
    modelsSnapshot = { source, models: getModels() }
  }
  return modelsSnapshot.models
}

/** Reactive picker list — updates when the remote catalog refreshes. */
export function useModels(): ModelOption[] {
  return useSyncExternalStore(subscribeModelCatalog, getModelsCached)
}

/**
 * The agent backend that runs a model id, mirroring the backend's own rule
 * (`opencode/...` ids → OpenCode; `gpt`/`codex` prefixes → Codex; everything
 * else → Claude). Keep this in sync with `Backend::for_model` in
 * crates/warden-core (the catalog can add models, not backends — new ids must
 * follow these prefixes).
 */
export function backendForModel(id: string): Backend {
  const lower = baseModelId(id).toLowerCase()
  // Prefixed ids route first, before the gpt/codex → codex fallback and the
  // Claude catch-all. Keep in sync with each provider's `handles_model` in Rust.
  if (lower.startsWith("cursor/")) return "cursor"
  if (lower.startsWith("grok/")) return "grok"
  if (lower.startsWith("opencode")) return "opencode"
  return lower.startsWith("gpt") || lower.startsWith("codex")
    ? "codex"
    : "claude"
}

/** Each backend's provider display name, for picker grouping of models that
 *  aren't in the catalog (dynamic OpenCode entries, resumed sessions on
 *  retired ids). */
export const BACKEND_PROVIDER_NAME: Record<Backend, string> = {
  claude: "Anthropic",
  codex: "OpenAI",
  opencode: "OpenCode",
  cursor: "Cursor",
  grok: "Grok",
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

/** The catalog's fast (priority service tier) variant for a base id, if any. */
function fastVariantOf(base: string): string | undefined {
  return getModelCatalog().models.find((m) => m.id === base)?.fastId
}

/**
 * Whether a model id is a warden fast-tier variant. True only when the id is
 * exactly some catalog model's `fastId` — i.e. stripping the `-fast` suffix
 * yields a base whose `fastId` is this id. Native ids that merely end in
 * `-fast` (Grok's `grok/grok-composer-2.5-fast`, Cursor's
 * `cursor/composer-2.5-fast`) are the real models the CLIs advertise, not
 * warden variants, so they return false and show no zap indicator.
 */
export function isFastModel(id: string): boolean {
  if (!id.endsWith(FAST_SUFFIX)) return false
  return fastVariantOf(id.slice(0, -FAST_SUFFIX.length)) === id
}

/** The id with a warden fast-tier suffix stripped; native `-fast` ids (which
 *  are not catalog fast variants) pass through unchanged. */
export function baseModelId(id: string): string {
  return isFastModel(id) ? id.slice(0, -FAST_SUFFIX.length) : id
}

/** Whether a model has a fast variant available. */
export function supportsFast(id: string): boolean {
  return fastVariantOf(baseModelId(id)) !== undefined
}

/** Toggle the fast tier on a model id, returning the appropriate variant. */
export function withFast(id: string, fast: boolean): string {
  const base = baseModelId(id)
  return (fast ? fastVariantOf(base) : undefined) ?? base
}

/** The default model for new chat sessions. Resolved at call time so a
 *  catalog refresh applies to the next session, never an existing one. */
export function defaultChatModel(): string {
  return getModelCatalog().defaults.chat
}

export function defaultPlannerModel(): string {
  return getModelCatalog().defaults.planner
}

export function defaultCoderModel(): string {
  return getModelCatalog().defaults.coder
}

/** Each backend's default chat model — what a new session of that provider
 *  starts on. */
export function defaultModelFor(backend: Backend): string {
  const { defaults } = getModelCatalog()
  switch (backend) {
    case "codex":
      return defaults.codexChat
    case "opencode":
      return defaults.opencodeChat
    case "cursor":
      return defaults.cursorChat
    case "grok":
      return defaults.grokChat
    default:
      return defaults.chat
  }
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
 * resumed sessions never show a raw id. Hidden models resolve too — retiring
 * a model from the picker must not break sessions already on it.
 */
export function formatModelName(id: string): string {
  if (!id) return "Model"

  let base = baseModelId(id)
  const known = getModelCatalog().models.find((m) => m.id === base)
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
  // A Claude Code session setting on top of xhigh effort (the agent also
  // orchestrates dynamic workflows). Other backends clamp it to their top tier.
  { value: "ultracode", label: "Ultracode" },
]

const GROK_EFFORTS: EffortLevel[] = ["low", "medium", "high"]

/** The effort tiers a backend actually offers. Cursor has no effort control (the
 *  picker hides it); Grok exposes low/medium/high; Ultracode is Claude-only. */
export function effortOptionsFor(backend?: Backend): EffortOption[] {
  if (backend === "cursor") return []
  if (backend === "grok") {
    return EFFORT_OPTIONS.filter((o) => GROK_EFFORTS.includes(o.value))
  }
  return backend === "claude" || backend === undefined
    ? EFFORT_OPTIONS
    : EFFORT_OPTIONS.filter((o) => o.value !== "ultracode")
}

export function effortLabel(value: EffortLevel): string {
  return EFFORT_OPTIONS.find((o) => o.value === value)?.label ?? value
}
