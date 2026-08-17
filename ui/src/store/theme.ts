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

let currentAccent: string | null = null
let currentBorderVisibility = 'subtle'

async function applyById(id: string): Promise<AppTheme | null> {
  const eff = effectiveId(id)
  const theme = await getTheme(eff)
  if (theme) {
    applyTheme(theme, { accent: currentAccent, borderVisibility: currentBorderVisibility })
    return theme
  }
  const fallback = await getTheme('dark-modern')
  if (fallback) applyTheme(fallback, { accent: currentAccent, borderVisibility: currentBorderVisibility })
  return fallback
}

export function setThemeOverrides(opts: { accent?: string | null; borderVisibility?: string }) {
  if (opts.accent !== undefined) currentAccent = opts.accent || null
  if (opts.borderVisibility !== undefined) currentBorderVisibility = opts.borderVisibility
  const { themeId, resolved } = useThemeStore.getState()
  if (resolved) applyTheme(resolved, { accent: currentAccent, borderVisibility: currentBorderVisibility })
  void themeId
}

interface ThemeState {
  themeId: string
  effectiveId: string
  resolved: AppTheme | null
  setThemeId: (id: string) => Promise<void>
  init: () => Promise<void>
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  themeId: initialThemeId(),
  effectiveId: effectiveId(initialThemeId()),
  resolved: null,

  setThemeId: async (id: string) => {
    localStorage.setItem(STORAGE_KEY, id)
    localStorage.removeItem(LEGACY_KEY)
    const eff = effectiveId(id)
    const theme = await applyById(id)
    set({ themeId: id, effectiveId: eff, resolved: theme })
  },

  init: async () => {
    const id = get().themeId
    const theme = await applyById(id)
    set({ effectiveId: effectiveId(id), resolved: theme })
  },
}))

void useThemeStore.getState().init()

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const { themeId } = useThemeStore.getState()
  if (themeId !== 'system') return
  void applyById('system').then((theme) => {
    useThemeStore.setState({ effectiveId: resolveSystemId(), resolved: theme })
  })
})

export function syncThemeFromSettings(themeId: string, accent?: string | null, borderVisibility?: string) {
  if (accent !== undefined || borderVisibility) {
    setThemeOverrides({ accent: accent ?? null, borderVisibility: borderVisibility || 'subtle' })
  }
  const current = useThemeStore.getState().themeId
  if (themeId && themeId !== current) {
    void useThemeStore.getState().setThemeId(themeId)
  } else if (!themeId && current === 'system') {
    void useThemeStore.getState().init()
  } else if (accent !== undefined || borderVisibility) {
    const resolved = useThemeStore.getState().resolved
    if (resolved) applyTheme(resolved, { accent: accent ?? null, borderVisibility: borderVisibility || 'subtle' })
  }
}

export function themeTypeForMermaid(): 'dark' | 'default' {
  const t = useThemeStore.getState().resolved?.meta.type
  return t === 'light' ? 'default' : 'dark'
}
