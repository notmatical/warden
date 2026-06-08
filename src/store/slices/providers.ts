import { toast } from "sonner"
import type { StateCreator } from "zustand"

import * as ipc from "@/lib/ipc"
import { reportError } from "../shared"
import type { AppState } from "../types"

type ProvidersSlice = Pick<
  AppState,
  | "providers"
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

/** Agent-CLI provider status (Claude/Codex) and the GitHub CLI: load, install,
 *  update, and switch managed/system source. */
export const createProvidersSlice: StateCreator<
  AppState,
  [],
  [],
  ProvidersSlice
> = (set, get) => ({
  providers: [],
  githubStatus: null,

  loadProviders: async () => {
    try {
      const providers = await ipc.listProviderStatus()
      set({ providers })
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
