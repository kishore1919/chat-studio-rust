import { create } from 'zustand'
import { ipc } from '../lib/ipc'
import type { ThemePreference } from '../lib/types'

export type ThemeId = ThemePreference

const STORAGE_KEY = 'chat-studio-theme-id'
const LEGACY_KEY = 'chat-studio-theme'

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolveType(id: ThemeId): 'light' | 'dark' {
  if (id === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return id
}

/** Reads whatever was last persisted and folds it down to light/dark/system.
 * Older installs may have a VS Code-style id in here (e.g. 'dark-modern',
 * 'solarized-light') from before the theme system was simplified down to
 * Cherry Studio-style light/dark - those get bucketed by their known prefix
 * rather than lost, so switching themes isn't required to fix a "stuck" id. */
function initialThemeId(): ThemeId {
  const stored = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  if (stored) {
    if (stored.startsWith('light') || stored === 'solarized-light') return 'light'
    if (stored) return 'dark'
  }
  return 'system'
}

/** Must run before `createRoot().render()` in main.tsx. index.html's inline
 * script sets `data-theme` pre-paint from localStorage alone (it can't await
 * an IPC settings round-trip); deferring this into a React effect would
 * reintroduce a flash of the wrong palette between first paint and the
 * effect running. */
function applyType(type: 'light' | 'dark', fontSize: number) {
  document.documentElement.dataset.theme = type
  document.documentElement.style.setProperty('--chat-font-size', `${fontSize}px`)
  try {
    void ipc.setWindowTheme(type).catch(() => {})
  } catch {
    // Non-fatal if running outside Tauri / in a headless browser test
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return hex
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return hex
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Overrides the palette's default green accent - `--primary`/`--ring` follow
 * it directly, `--accent-bg` is a translucent tint used for hover/selection
 * surfaces. `null` removes the inline overrides, falling back to index.css's
 * default green (applied on `:root`/`[data-theme='dark']`, which the removed
 * inline properties no longer shadow). */
function applyAccent(accent: string | null) {
  const root = document.documentElement.style
  if (accent) {
    root.setProperty('--accent', accent)
    root.setProperty('--primary', accent)
    root.setProperty('--ring', accent)
    root.setProperty('--accent-bg', hexToRgba(accent, 0.14))
  } else {
    root.removeProperty('--accent')
    root.removeProperty('--primary')
    root.removeProperty('--ring')
    root.removeProperty('--accent-bg')
  }
}

interface ThemeState {
  themeId: ThemeId
  resolvedType: 'light' | 'dark'
  fontSize: number
  accent: string | null
  setThemeId: (id: ThemeId) => void
  setFontSize: (size: number) => void
  setAccent: (accent: string | null) => void
  /** Re-resolves and re-applies only if currently following the OS
   * preference - a no-op otherwise. Called by App.tsx's matchMedia listener. */
  refreshIfSystem: () => void
  init: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  themeId: initialThemeId(),
  resolvedType: resolveType(initialThemeId()),
  fontSize: 16,
  accent: null,

  setThemeId: (id) => {
    localStorage.setItem(STORAGE_KEY, id)
    localStorage.removeItem(LEGACY_KEY)
    const type = resolveType(id)
    applyType(type, get().fontSize)
    set({ themeId: id, resolvedType: type })
  },

  setFontSize: (fontSize) => {
    document.documentElement.style.setProperty('--chat-font-size', `${fontSize}px`)
    set({ fontSize })
  },

  setAccent: (accent) => {
    applyAccent(accent)
    set({ accent })
  },

  refreshIfSystem: () => {
    if (get().themeId !== 'system') return
    const type = resolveType('system')
    applyType(type, get().fontSize)
    set({ resolvedType: type })
  },

  init: () => {
    const type = resolveType(get().themeId)
    applyType(type, get().fontSize)
    applyAccent(get().accent)
    set({ resolvedType: type })
  },
}))

export function initTheme() {
  useThemeStore.getState().init()
}

/** `settings.theme_id`/`settings.accent` (persisted server-side) are the
 * source of truth once settings load; localStorage is a write-through cache
 * read only by index.html's pre-paint inline script (which can't await an
 * IPC round-trip before first paint). */
export function syncThemeFromSettings(themeId: string, accent: string | null | undefined, fontSize?: number) {
  const store = useThemeStore.getState()
  if (fontSize !== undefined && fontSize !== store.fontSize) {
    store.setFontSize(fontSize)
  }
  if (accent !== undefined && accent !== store.accent) {
    store.setAccent(accent)
  }
  const id: ThemeId = themeId === 'light' || themeId === 'dark' ? themeId : 'system'
  if (id !== store.themeId) {
    store.setThemeId(id)
  }
}
