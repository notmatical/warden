import { toast } from "sonner"
import type { StateCreator } from "zustand"

import * as ipc from "@/lib/ipc"
import { reportError } from "../shared"
import type { AppState } from "../types"

type ProvidersSlice = Pick<
  AppState,
  | "providers"
  | "opencodeModels"
  | "opencodeModelsLoading"
  | "cursorModels"
  | "cursorModelsLoading"
  | "grokModels"
  | "grokModelsLoading"
  | "githubStatus"
  | "loadProviders"
  | "installProvider"
  | "updateProvider"
  | "setProviderSource"
  | "loadGithubStatus"
  | "installGithub"
  | "updateGithub"
  | "setGithubSource"
>

/** Dynamic model availability is per-account and each listing shells out to its
 *  CLI, so refreshes (provider loads re-run on every window focus) are throttled. */
const MODELS_TTL_MS = 60_000

/** The backends whose picker models come live from their CLI rather than the
 *  static catalog. Each maps a provider id to its listing call and store slots. */
const DYNAMIC_MODEL_BACKENDS = [
  {
    id: "opencode",
    provider: "OpenCode",
    list: ipc.listOpencodeModels,
    models: "opencodeModels",
    loading: "opencodeModelsLoading",
  },
  {
    id: "cursor",
    provider: "Cursor",
    list: ipc.listCursorModels,
    models: "cursorModels",
    loading: "cursorModelsLoading",
  },
  {
    id: "grok",
    provider: "Grok",
    list: ipc.listGrokModels,
    models: "grokModels",
    loading: "grokModelsLoading",
  },
] as const

const modelsFetchedAt: Record<string, number> = {}

/** Agent-CLI provider status (Claude/Codex/OpenCode) and the GitHub CLI: load,
 *  install, update, and switch managed/system source. */
export const createProvidersSlice: StateCreator<
  AppState,
  [],
  [],
  ProvidersSlice
> = (set, get) => ({
  providers: [],
  opencodeModels: [],
  opencodeModelsLoading: false,
  cursorModels: [],
  cursorModelsLoading: false,
  grokModels: [],
  grokModelsLoading: false,
  githubStatus: null,

  loadProviders: async () => {
    try {
      const providers = await ipc.listProviderStatus()
      set({ providers })

      // Refresh each dynamic backend's model catalog alongside provider status:
      // the picker only shows models the account can run, which shifts with
      // sign-ins done inside or outside the app.
      for (const backend of DYNAMIC_MODEL_BACKENDS) {
        const status = providers.find((p) => p.id === backend.id)
        const stale =
          Date.now() - (modelsFetchedAt[backend.id] ?? 0) > MODELS_TTL_MS
        const empty = (get()[backend.models] as unknown[]).length === 0
        if (!status?.installed || !(stale || empty)) continue

        modelsFetchedAt[backend.id] = Date.now()
        // The listing shells out to the CLI (seconds); the picker shows a
        // skeleton while this is true and no models are known yet.
        set({ [backend.loading]: true } as Partial<AppState>)
        void backend
          .list()
          .then((models) =>
            set({
              [backend.models]: models.map((m) => ({
                ...m,
                provider: backend.provider,
              })),
            } as Partial<AppState>)
          )
          .catch(() => {
            // CLI hiccups just leave the previous (possibly empty) list.
          })
          .finally(() => set({ [backend.loading]: false } as Partial<AppState>))
      }
    } catch (error) {
      reportError("Failed to load providers", error)
    }
  },

  installProvider: async (id) => {
    const name = get().providers.find((p) => p.id === id)?.name ?? id
    try {
      await ipc.installProvider(id)
      await get().loadProviders()
      toast.success(`Installed ${name}`)
    } catch (error) {
      reportError(`Failed to install ${name}`, error)
    }
  },

  updateProvider: async (id) => {
    const name = get().providers.find((p) => p.id === id)?.name ?? id
    try {
      await ipc.updateProvider(id)
      await get().loadProviders()
      toast.success(`Updated ${name}`)
    } catch (error) {
      reportError(`Failed to update ${name}`, error)
    }
  },

  setProviderSource: async (id, source) => {
    // Optimistically reflect the choice; loadProviders reconciles the resolved
    // binary, version, and update availability for the new source.
    set((state) => ({
      providers: state.providers.map((p) =>
        p.id === id ? { ...p, source } : p
      ),
    }))
    try {
      await ipc.setProviderSource(id, source)
      await get().loadProviders()
    } catch (error) {
      reportError("Failed to change CLI source", error)
      await get().loadProviders()
    }
  },

  loadGithubStatus: async () => {
    try {
      set({ githubStatus: await ipc.githubStatus() })
    } catch (error) {
      reportError("Failed to load GitHub CLI status", error)
    }
  },

  installGithub: async () => {
    try {
      await ipc.installGithubCli()
      await get().loadGithubStatus()
      toast.success("Installed GitHub CLI")
    } catch (error) {
      reportError("Failed to install GitHub CLI", error)
    }
  },

  updateGithub: async () => {
    try {
      await ipc.updateGithubCli()
      await get().loadGithubStatus()
      toast.success("Updated GitHub CLI")
    } catch (error) {
      reportError("Failed to update GitHub CLI", error)
    }
  },

  setGithubSource: async (source) => {
    set((state) => ({
      githubStatus: state.githubStatus
        ? { ...state.githubStatus, source }
        : state.githubStatus,
    }))
    try {
      await ipc.setGithubSource(source)
      await get().loadGithubStatus()
    } catch (error) {
      reportError("Failed to change CLI source", error)
      await get().loadGithubStatus()
    }
  },
})
