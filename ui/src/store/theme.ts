import { create } from 'zustand'
import lightHljs from 'highlight.js/styles/github.css?raw'
import darkHljs from 'highlight.js/styles/github-dark.css?raw'
import type { ThemePreference } from '../lib/types'

const STORAGE_KEY = 'chat-studio-theme'
const HLJS_STYLE_ID = 'hljs-theme'

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolve(pref: ThemePreference): 'light' | 'dark' {
  return pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref
}

function applyToDom(resolved: 'light' | 'dark') {
  document.documentElement.dataset.theme = resolved

  let styleEl = document.getElementById(HLJS_STYLE_ID) as HTMLStyleElement | null
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = HLJS_STYLE_ID
    document.head.appendChild(styleEl)
  }
  styleEl.textContent = resolved === 'dark' ? darkHljs : lightHljs
}

interface ThemeState {
  preference: ThemePreference
  resolved: 'light' | 'dark'
  setPreference: (pref: ThemePreference) => void
}

const initialPreference = (localStorage.getItem(STORAGE_KEY) as ThemePreference | null) ?? 'system'

export const useThemeStore = create<ThemeState>((set) => ({
  preference: initialPreference,
  resolved: resolve(initialPreference),
  setPreference: (pref) => {
    localStorage.setItem(STORAGE_KEY, pref)
    const resolved = resolve(pref)
    applyToDom(resolved)
    set({ preference: pref, resolved })
  },
}))

// Apply immediately on module load (index.html's inline script already set
// data-theme for first paint; this call sets the hljs stylesheet to match
// and keeps the store's resolved value in sync).
applyToDom(useThemeStore.getState().resolved)

// Live-follow the OS when preference is "system".
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const { preference } = useThemeStore.getState()
  if (preference !== 'system') return
  const resolved = resolve('system')
  applyToDom(resolved)
  useThemeStore.setState({ resolved })
})
