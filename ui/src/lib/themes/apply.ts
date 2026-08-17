import type { AppTheme } from './types'

const TOKEN_ID = 'app-theme-tokens'

/** Tracks which theme's rules are currently in the `<style>` element, so a
 * same-theme call (an accent or border-visibility tweak) can skip rewriting
 * it - only the id, not the whole object, so a re-resolved-but-identical
 * theme still counts as unchanged. */
let lastTokenThemeId: string | null = null

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return hex
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Writes each CSS variable individually via `style.setProperty` rather than
 * rewriting a `<style>` block's `textContent`. Settings.tsx calls this on
 * every color-picker drag tick, and the old approach forced a full-document
 * style recalculation per tick; an inline style on `:root` also beats a
 * stylesheet rule by specificity on its own, which is what the old
 * `!important` hack stood in for. */
export function applyTheme(
  theme: AppTheme,
  opts?: { accent?: string | null; borderVisibility?: string; fontSize?: number },
) {
  document.documentElement.dataset.theme = theme.meta.type
  const root = document.documentElement.style

  const vars = { ...theme.vars }
  if (opts?.fontSize) {
    vars['--chat-font-size'] = `${opts.fontSize}px`
  }
  if (opts?.accent) {
    vars['--accent'] = opts.accent
    vars['--primary'] = opts.accent
    vars['--ring'] = opts.accent
    vars['--accent-bg'] = hexToRgba(opts.accent, 0.12)
  }
  const vis = opts?.borderVisibility || 'subtle'
  const borderVar = vars['--border'] || '#2d2d30'
  const borderStrongVar = vars['--border-strong'] || borderVar
  if (vis === 'hidden') {
    vars['--border'] = 'transparent'
    vars['--border-strong'] = 'transparent'
  } else if (vis !== 'strong') {
    const a = vis === 'soft' ? 0.35 : 0.4
    if (borderVar.startsWith('#')) vars['--border'] = hexToRgba(borderVar, a)
    if (borderStrongVar.startsWith('#')) vars['--border-strong'] = hexToRgba(borderStrongVar, a + 0.15)
  }

  for (const [key, value] of Object.entries(vars)) {
    // Skip the write entirely when unchanged - `setProperty` still triggers
    // style invalidation even when the value is identical.
    if (root.getPropertyValue(key) !== value) {
      root.setProperty(key, value)
    }
  }

  // Real CSS rules, not variables - keep as a stylesheet, but only rewrite it
  // when the underlying theme actually changed, not on every accent/border
  // tweak against the same theme.
  if (lastTokenThemeId !== theme.meta.id) {
    let tokenEl = document.getElementById(TOKEN_ID) as HTMLStyleElement | null
    if (!tokenEl) {
      tokenEl = document.createElement('style')
      tokenEl.id = TOKEN_ID
      document.head.appendChild(tokenEl)
    }
    tokenEl.textContent = theme.tokenCss
    lastTokenThemeId = theme.meta.id
  }
}

export function clearThemeOverrides() {
  const root = document.documentElement.style
  // Snapshot first - removing properties while iterating the live
  // `CSSStyleDeclaration` would skip entries as the list shrinks underneath
  // the loop.
  const props: string[] = []
  for (let i = 0; i < root.length; i++) {
    props.push(root.item(i))
  }
  for (const prop of props) {
    if (prop.startsWith('--')) root.removeProperty(prop)
  }
  document.getElementById(TOKEN_ID)?.remove()
  lastTokenThemeId = null
}
