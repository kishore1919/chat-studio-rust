export interface VsCodeThemeRaw {
  name: string
  type: 'light' | 'dark' | 'hc' | 'hcLight' | string
  colors?: Record<string, string>
  tokenColors?: TokenColor[]
  semanticTokenColors?: Record<string, string | { foreground?: string; fontStyle?: string }>
  semanticHighlighting?: boolean
}

export interface TokenColor {
  name?: string
  scope?: string | string[]
  settings: { foreground?: string; background?: string; fontStyle?: string }
}

export interface ThemeMeta {
  id: string
  name: string
  type: 'light' | 'dark'
  builtin: boolean
}

export interface AppTheme {
  meta: ThemeMeta
  raw: VsCodeThemeRaw
  vars: Record<string, string>
  tokenCss: string
}

export function normalizeType(t: string): 'light' | 'dark' {
  if (t === 'light' || t === 'hcLight') return 'light'
  return 'dark'
}
