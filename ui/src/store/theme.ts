import { create } from 'zustand'
import type { AppTheme } from '../lib/themes/types'
import { applyTheme } from '../lib/themes/apply'
import { getTheme } from '../lib/themes/registry'

const STORAGE_KEY = 'chat-studio-theme-id'
const LEGACY_KEY = 'chat-studio-theme'

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolveSystemId(): string {
  return systemPrefersDark() ? 'dark-modern' : 'light-modern'
}

function legacyToId(pref: string): string {
  if (pref === 'light') return 'light-modern'
  if (pref === 'dark') return 'dark-modern'
  return 'system'
}

function initialThemeId(): string {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) return stored
  const legacy = localStorage.getItem(LEGACY_KEY)
  if (legacy) return legacyToId(legacy)
  return 'system'
}

function effectiveId(id: string): string {
  if (id === 'system') return resolveSystemId()
  return id
}

interface ThemeOverrides {
  accent: string | null
  borderVisibility: string
  fontSize: number
}

const DEFAULT_OVERRIDES: ThemeOverrides = {
  accent: null,
  borderVisibility: 'subtle',
  fontSize: 14,
}

interface ThemeState {
  themeId: string
  effectiveId: string
  resolved: AppTheme | null
  overrides: ThemeOverrides
  setThemeId: (id: string) => Promise<void>
  setOverrides: (opts: Partial<ThemeOverrides>) => void
  /** Re-resolves and re-applies only if currently following the OS
   * preference - a no-op otherwise. Called by App.tsx's matchMedia listener. */
  refreshIfSystem: () => Promise<void>
  init: () => Promise<void>
}

async function resolveAndApply(id: string, overrides: ThemeOverrides): Promise<AppTheme | null> {
  const eff = effectiveId(id)
  const theme = await getTheme(eff)
  if (theme) {
    applyTheme(theme, overrides)
    return theme
  }
  const fallback = await getTheme('dark-modern')
  if (fallback) applyTheme(fallback, overrides)
  return fallback
}

// `settings.theme_id` (persisted server-side) is the single source of truth
// once settings load; `localStorage` is a write-through cache read only by
// index.html's pre-paint inline script (which can't await an IPC round-trip
// before first paint); `themeId` here is a mirror, written only by
// `setThemeId`. Overrides (accent/border/font-size) used to live as bare
// module-level `let`s that React couldn't observe - moved into real store
// state so Settings can read them reactively instead of reaching past the
// store.
export const useThemeStore = create<ThemeState>((set, get) => ({
  themeId: initialThemeId(),
  effectiveId: effectiveId(initialThemeId()),
  resolved: null,
  overrides: DEFAULT_OVERRIDES,

  setThemeId: async (id) => {
    localStorage.setItem(STORAGE_KEY, id)
    localStorage.removeItem(LEGACY_KEY)
    const eff = effectiveId(id)
    const theme = await resolveAndApply(id, get().overrides)
    set({ themeId: id, effectiveId: eff, resolved: theme })
  },

  setOverrides: (opts) => {
    const overrides = { ...get().overrides, ...opts }
    set({ overrides })
    const resolved = get().resolved
    if (resolved) applyTheme(resolved, overrides)
  },

  refreshIfSystem: async () => {
    if (get().themeId !== 'system') return
    const theme = await resolveAndApply('system', get().overrides)
    set({ effectiveId: resolveSystemId(), resolved: theme })
  },

  init: async () => {
    const id = get().themeId
    const theme = await resolveAndApply(id, get().overrides)
    set({ effectiveId: effectiveId(id), resolved: theme })
  },
}))

/** Must run before `createRoot().render()` in main.tsx. index.html's inline
 * script sets `data-theme` pre-paint from localStorage alone (it can't await
 * an IPC settings round-trip); deferring this call into a React effect would
 * reintroduce a flash of the wrong palette between first paint and the
 * effect running. */
export function initTheme() {
  void useThemeStore.getState().init()
}

export function setThemeOverrides(opts: { accent?: string | null; borderVisibility?: string; fontSize?: number }) {
  useThemeStore.getState().setOverrides(opts)
}

export function syncThemeFromSettings(
  themeId: string,
  accent?: string | null,
  borderVisibility?: string,
  fontSize?: number,
) {
  const hasOverrides = accent !== undefined || borderVisibility !== undefined || fontSize !== undefined
  if (hasOverrides) {
    setThemeOverrides({ accent: accent ?? null, borderVisibility: borderVisibility || 'subtle', fontSize })
  }
  const current = useThemeStore.getState().themeId
  if (themeId && themeId !== current) {
    void useThemeStore.getState().setThemeId(themeId)
  } else if (!themeId && current === 'system') {
    void useThemeStore.getState().init()
  }
  // `setOverrides` above already re-applied against the currently resolved
  // theme, so there's nothing left to do when only overrides changed.
}

export function themeTypeForMermaid(): 'dark' | 'default' {
  const t = useThemeStore.getState().resolved?.meta.type
  return t === 'light' ? 'default' : 'dark'
}
