import type { AppTheme } from './types'

const VARS_ID = 'app-theme-vars'
const TOKEN_ID = 'app-theme-tokens'

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return hex
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function applyTheme(
  theme: AppTheme,
  opts?: { accent?: string | null; borderVisibility?: string },
) {
  document.documentElement.dataset.theme = theme.meta.type

  let varsEl = document.getElementById(VARS_ID) as HTMLStyleElement | null
  if (!varsEl) {
    varsEl = document.createElement('style')
    varsEl.id = VARS_ID
    document.head.appendChild(varsEl)
  }
  const vars = { ...theme.vars }
  if (opts?.accent) {
    vars['--accent'] = opts.accent
    vars['--primary'] = opts.accent
    vars['--ring'] = opts.accent
    vars['--accent-bg'] = hexToRgba(opts.accent, 0.12)
  }
  const vis = opts?.borderVisibility || 'subtle'
  const borderAlpha = vis === 'hidden' ? '0' : vis === 'strong' ? '1' : vis === 'soft' ? '0.5' : '0.4'
  const borderVar = vars['--border'] || '#2d2d30'
  const borderStrongVar = vars['--border-strong'] || borderVar
  if (vis === 'hidden') {
    vars['--border'] = 'transparent'
    vars['--border-strong'] = 'transparent'
  } else if (vis !== 'strong') {
    const a = vis === 'soft' ? 0.35 : 0.4
    if (borderVar.startsWith('#')) vars['--border'] = hexToRgba(borderVar, a)
    if (borderStrongVar.startsWith('#')) vars['--border-strong'] = hexToRgba(borderStrongVar, a + 0.15)
    void borderAlpha
  }
  const lines = Object.entries(vars).map(([k, v]) => `  ${k}: ${v} !important;`)
  varsEl.textContent = `:root, :root[data-theme='light'], :root[data-theme='dark'] {\n${lines.join('\n')}\n}`

  let tokenEl = document.getElementById(TOKEN_ID) as HTMLStyleElement | null
  if (!tokenEl) {
    tokenEl = document.createElement('style')
    tokenEl.id = TOKEN_ID
    document.head.appendChild(tokenEl)
  }
  tokenEl.textContent = theme.tokenCss
}

export function clearThemeOverrides() {
  document.getElementById(VARS_ID)?.remove()
  document.getElementById(TOKEN_ID)?.remove()
}
