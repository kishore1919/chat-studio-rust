import { create } from 'zustand'
import { ipc } from '../lib/ipc'
import { syncThemeFromSettings } from './theme'
import type { ModelInfo, ProviderConfig, Settings } from '../lib/types'

interface SettingsState {
  settings: Settings | null
  modelsByProvider: Record<string, ModelInfo[]>
  loading: boolean
  load: () => Promise<void>
  save: (next: Settings) => Promise<void>
  /** Updates local state only, with no IPC write - paired with a debounced
   * persist call at the callsite so a rapid-fire control (a slider, a
   * color-picker drag) stays visually responsive without saving on every
   * tick. */
  setLocalSettings: (next: Settings) => void
  addProvider: (provider: ProviderConfig) => Promise<void>
  removeProvider: (providerId: string) => Promise<void>
  refreshModels: (providerId: string, force?: boolean) => Promise<void>
  prefetchEnabledProviderModels: () => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  modelsByProvider: {},
  loading: false,

  load: async () => {
    set({ loading: true })
    const settings = await ipc.getSettings()
    set({ settings, loading: false })
    syncThemeFromSettings(settings.theme_id, settings.accent ?? null, settings.border_visibility || 'subtle', settings.font_size)
  },

  save: async (next) => {
    await ipc.saveSettings(next)
    set({ settings: next })
  },

  setLocalSettings: (next) => set({ settings: next }),

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

  // Deliberately fire-and-forget (not awaited by callers) so the unified
  // model picker in the header has something to show without making
  // startup wait on a network round trip per provider. The backend already
  // caches each provider's list for 5 minutes, so this is cheap on repeat
  // launches and any provider that fails (bad key, unreachable) just stays
  // empty in the picker rather than blocking the rest of the app.
  prefetchEnabledProviderModels: () => {
    const settings = get().settings
    if (!settings) return
    for (const provider of settings.providers) {
      if (!provider.enabled) continue
      if (get().modelsByProvider[provider.id]) continue
      get()
        .refreshModels(provider.id, false)
        .catch(() => {})
    }
  },
}))
