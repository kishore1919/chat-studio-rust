import { invoke } from '@tauri-apps/api/core'
import { BUILTIN_THEMES, getBuiltinRaw } from './builtin'
import { parseVsCodeTheme } from './parse'
import type { AppTheme, ThemeMeta } from './types'

const cache = new Map<string, AppTheme>()

export function listBuiltinMetas(): ThemeMeta[] {
  return BUILTIN_THEMES
}

export async function listCustomMetas(): Promise<ThemeMeta[]> {
  try {
    const metas = await invoke<ThemeMeta[]>('list_themes')
    return metas
  } catch {
    return []
  }
}

export async function listAllMetas(): Promise<ThemeMeta[]> {
  const custom = await listCustomMetas()
  return [...BUILTIN_THEMES, ...custom]
}

export async function getTheme(id: string): Promise<AppTheme | null> {
  if (cache.has(id)) return cache.get(id)!
  const builtinRaw = getBuiltinRaw(id)
  if (builtinRaw) {
    const meta = BUILTIN_THEMES.find((m) => m.id === id)!
    const theme = parseVsCodeTheme(builtinRaw, meta)
    cache.set(id, theme)
    return theme
  }
  try {
    const content = await invoke<string>('get_theme_content', { themeId: id })
    const raw = JSON.parse(content)
    const customMetas = await listCustomMetas()
    const meta = customMetas.find((m) => m.id === id) || {
      id,
      name: raw.name || id,
      type: (raw.type === 'light' ? 'light' : 'dark') as 'light' | 'dark',
      builtin: false,
    }
    const theme = parseVsCodeTheme(raw, meta)
    cache.set(id, theme)
    return theme
  } catch {
    return null
  }
}

export function clearCache(id?: string) {
  if (id) cache.delete(id)
  else cache.clear()
}
