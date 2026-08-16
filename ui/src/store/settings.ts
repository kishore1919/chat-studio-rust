import { create } from 'zustand'
import { ipc } from '../lib/ipc'
import type { ModelInfo, ProviderConfig, Settings } from '../lib/types'
import { useThemeStore } from './theme'

interface SettingsState {
  settings: Settings | null
  modelsByProvider: Record<string, ModelInfo[]>
  loading: boolean
  load: () => Promise<void>
  save: (next: Settings) => Promise<void>
  addProvider: (provider: ProviderConfig) => Promise<void>
  removeProvider: (providerId: string) => Promise<void>
  refreshModels: (providerId: string, force?: boolean) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  modelsByProvider: {},
  loading: false,

  load: async () => {
    set({ loading: true })
    const settings = await ipc.getSettings()
    set({ settings, loading: false })
    // Backend is the source of truth for a user-chosen theme override;
    // reconcile it into the store that already painted from localStorage.
    useThemeStore.getState().setPreference(settings.theme)
  },

  save: async (next) => {
    await ipc.saveSettings(next)
    set({ settings: next })
  },

  addProvider: async (provider) => {
    await ipc.addProvider(provider)
    await get().load()
  },

  removeProvider: async (providerId) => {
    await ipc.removeProvider(providerId)
    await get().load()
  },

  refreshModels: async (providerId, force = false) => {
    const models = await ipc.listModels(providerId, force)
    set((s) => ({ modelsByProvider: { ...s.modelsByProvider, [providerId]: models } }))
  },
}))
