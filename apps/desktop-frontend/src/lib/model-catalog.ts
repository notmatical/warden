import bundledCatalog from "@/config/models.json"

/**
 * The dynamic model catalog (docs/MODEL-CATALOG.md). The bundled models.json
 * is also published from the repo's main branch, so installed apps refresh
 * their picker without a release. Fallback chain: remote → localStorage cache
 * → bundled copy. Consumers read a synchronous snapshot (seeded from
 * cache/bundled before the first fetch resolves) and subscribe for updates.
 */

export interface CatalogModel {
  id: string
  label: string
  /** Display grouping (vendor name); the running backend derives from the id. */
  provider: string
  /** The model's priority-service-tier variant, when it has one. */
  fastId?: string
  /** Picker highlight. */
  recommended?: boolean
  /** Listed but sorted last — the grace period before `hidden`. */
  deprecated?: boolean
  /** Usable (resumed sessions still render) but not offered in the picker. */
  hidden?: boolean
}

export interface CatalogDefaults {
  chat: string
  planner: string
  coder: string
  codexChat: string
  opencodeChat: string
  cursorChat: string
  grokChat: string
}

export interface ModelCatalog {
  version: 1
  updatedAt?: string
  models: CatalogModel[]
  defaults: CatalogDefaults
}

const CATALOG_URL =
  "https://raw.githubusercontent.com/notmatical/warden/main/apps/desktop-frontend/src/config/models.json"
const CACHE_KEY = "warden:model-catalog:v1"
const REFRESH_INTERVAL_MS = 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 8000

export const BUNDLED_CATALOG: ModelCatalog =
  // The bundled file is the same document the remote serves; parse it through
  // the same validator so a bad local edit fails loudly in dev, not silently.
  parseCatalog(bundledCatalog) ??
  (() => {
    throw new Error("bundled models.json failed catalog validation")
  })()

// ----- validation -------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function parseModel(value: unknown): CatalogModel | null {
  if (!isRecord(value)) return null
  const { id, label, provider } = value
  if (!nonEmptyString(id) || !nonEmptyString(label) || !nonEmptyString(provider))
    return null
  return {
    id,
    label,
    provider,
    fastId: nonEmptyString(value.fastId) ? value.fastId : undefined,
    recommended: value.recommended === true || undefined,
    deprecated: value.deprecated === true || undefined,
    hidden: value.hidden === true || undefined,
  }
}

/**
 * Validate an untrusted catalog document. Unknown fields are ignored and
 * malformed model entries dropped individually; only a wrong `version`, a
 * missing model list, or unusable defaults reject the whole document.
 */
export function parseCatalog(raw: unknown): ModelCatalog | null {
  if (!isRecord(raw) || raw.version !== 1) return null
  if (!Array.isArray(raw.models) || !isRecord(raw.defaults)) return null

  const models = raw.models
    .map(parseModel)
    .filter((m): m is CatalogModel => m !== null)
  if (models.length === 0) return null

  const d = raw.defaults
  const required = [
    "chat",
    "planner",
    "coder",
    "codexChat",
    "opencodeChat",
    "cursorChat",
    "grokChat",
  ]
  if (!required.every((key) => nonEmptyString(d[key]))) return null

  return {
    version: 1,
    updatedAt: nonEmptyString(raw.updatedAt) ? raw.updatedAt : undefined,
    models,
    defaults: {
      chat: d.chat as string,
      planner: d.planner as string,
      coder: d.coder as string,
      codexChat: d.codexChat as string,
      opencodeChat: d.opencodeChat as string,
      cursorChat: d.cursorChat as string,
      grokChat: d.grokChat as string,
    },
  }
}

// ----- cache ------------------------------------------------------------------

interface CacheEntry {
  catalog: ModelCatalog
  fetchedAt: number
}

function readCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { catalog?: unknown; fetchedAt?: unknown }
    const catalog = parseCatalog(parsed.catalog)
    if (!catalog || typeof parsed.fetchedAt !== "number") return null
    return { catalog, fetchedAt: parsed.fetchedAt }
  } catch {
    return null
  }
}

function writeCache(catalog: ModelCatalog): void {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ catalog, fetchedAt: Date.now() })
    )
  } catch {
    // Storage full/unavailable — the snapshot still updated for this run.
  }
}

// ----- snapshot store ---------------------------------------------------------

let snapshot: ModelCatalog = readCache()?.catalog ?? BUNDLED_CATALOG
const listeners = new Set<() => void>()

export function getModelCatalog(): ModelCatalog {
  return snapshot
}

export function subscribeModelCatalog(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setSnapshot(catalog: ModelCatalog): void {
  // Referential stability matters: pickers subscribe via useSyncExternalStore,
  // so only swap (and notify) when the content actually changed.
  if (JSON.stringify(catalog) === JSON.stringify(snapshot)) return
  snapshot = catalog
  for (const listener of listeners) listener()
}

// ----- refresh ----------------------------------------------------------------

async function fetchRemoteCatalog(force: boolean): Promise<ModelCatalog | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    // GitHub's raw CDN caches ~5 minutes; a forced refresh busts through it.
    const url = force ? `${CATALOG_URL}?t=${Date.now()}` : CATALOG_URL
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    })
    if (!response.ok) return null
    return parseCatalog(await response.json())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Fetch the remote catalog and apply it. Any failure keeps the current
 *  snapshot (cache or bundled) — the picker is never empty. */
export async function refreshModelCatalog(force = false): Promise<boolean> {
  const catalog = await fetchRemoteCatalog(force)
  if (!catalog) return false
  writeCache(catalog)
  setSnapshot(catalog)
  return true
}

let syncStarted = false

/** Start background catalog sync: revalidate now (skipped when the cache is
 *  fresh, unless nothing is cached) and hourly thereafter. Idempotent. */
export function startModelCatalogSync(): void {
  if (syncStarted) return
  syncStarted = true
  const cache = readCache()
  if (!cache || Date.now() - cache.fetchedAt > REFRESH_INTERVAL_MS) {
    void refreshModelCatalog()
  }
  setInterval(() => void refreshModelCatalog(), REFRESH_INTERVAL_MS)
}
