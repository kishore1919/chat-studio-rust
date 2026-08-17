import type { AppTheme, ThemeMeta, VsCodeThemeRaw } from './types'
import { normalizeType } from './types'

const FALLBACK_LIGHT: Record<string, string> = {
  '--bg': '#ffffff',
  '--bg-elevated': '#f7f7f8',
  '--bg-sidebar': '#fafafa',
  '--bg-hover': '#f0f0f1',
  '--border': '#e5e4e7',
  '--border-strong': '#d8d7da',
  '--text': '#16171d',
  '--text-muted': '#6e6a78',
  '--accent': '#007acc',
}

const FALLBACK_DARK: Record<string, string> = {
  '--bg': '#1e1e1e',
  '--bg-elevated': '#252526',
  '--bg-sidebar': '#181818',
  '--bg-hover': '#2a2d2e',
  '--border': '#2d2d30',
  '--border-strong': '#3c3c3c',
  '--text': '#cccccc',
  '--text-muted': '#858585',
  '--accent': '#007acc',
}

function pick(c: Record<string, string> | undefined, ...keys: string[]): string | undefined {
  if (!c) return undefined
  for (const k of keys) {
    if (c[k]) return c[k]
  }
  return undefined
}

export function workbenchToVars(raw: VsCodeThemeRaw): Record<string, string> {
  const type = normalizeType(raw.type || 'dark')
  const fb = type === 'light' ? FALLBACK_LIGHT : FALLBACK_DARK
  const c = raw.colors || {}
  const vars: Record<string, string> = {}

  vars['--bg'] = pick(c, 'editor.background', 'sideBar.background') || fb['--bg']
  vars['--bg-sidebar'] = pick(c, 'sideBar.background', 'activityBar.background', 'editor.background') || fb['--bg-sidebar']
  vars['--bg-elevated'] = pick(c, 'tab.activeBackground', 'editorGroupHeader.tabsBackground', 'panel.background', 'sideBar.background') || fb['--bg-elevated']
  vars['--bg-hover'] = pick(c, 'list.hoverBackground', 'editorWidget.background', 'input.background') || fb['--bg-hover']
  vars['--border'] = pick(c, 'sideBar.border', 'editorGroup.border', 'panel.border', 'widget.border') || fb['--border']
  vars['--border-strong'] = pick(c, 'focusBorder', 'sideBar.border') || fb['--border-strong']
  vars['--text'] = pick(c, 'editor.foreground', 'foreground', 'sideBar.foreground') || fb['--text']
  vars['--text-muted'] =
    pick(c, 'descriptionForeground', 'sideBar.foreground') || fb['--text-muted']
  const accent = pick(c, 'button.background', 'focusBorder', 'activityBarBadge.background', 'progressBar.background', 'editorCursor.foreground', 'activityBar.foreground') || fb['--accent'] || (type === 'light' ? '#007acc' : '#007acc')
  vars['--accent'] = accent
  vars['--accent-bg'] = accent + '1a'
  const bubbleUserBg =
    pick(c, 'editorHoverWidget.background', 'editorSuggestWidget.background') ||
    (type === 'light' ? '#e8f0fe' : '#264f78')
  vars['--bubble-user'] = bubbleUserBg
  vars['--bubble-assistant'] = pick(c, 'editor.background', 'panel.background') || vars['--bg-elevated']
  // --code-bg is deliberately absent here: code blocks are fixed to GitHub
  // Dark colors everywhere (see index.css), independent of the active theme.
  vars['--danger'] = pick(c, 'errorForeground', 'inputValidation.errorBorder') || (type === 'light' ? '#dc2626' : '#f87171')
  vars['--success'] = pick(c, 'terminal.ansiGreen', 'charts.green', 'testing.iconPassed') || (type === 'light' ? '#16a34a' : '#4ade80')

  vars['--background'] = vars['--bg']
  vars['--foreground'] = vars['--text']
  vars['--card'] = vars['--bg-elevated']
  vars['--card-foreground'] = vars['--text']
  vars['--popover'] = vars['--bg-elevated']
  vars['--popover-foreground'] = vars['--text']
  vars['--primary'] = vars['--accent']
  vars['--primary-foreground'] = type === 'light' ? '#ffffff' : '#16171d'
  vars['--muted'] = vars['--bg-elevated']
  vars['--muted-foreground'] = vars['--text-muted']
  vars['--border-color'] = vars['--border']
  vars['--input'] = vars['--border']
  vars['--ring'] = vars['--accent']

  if (type === 'dark') {
    vars['--destructive'] = vars['--danger']
    vars['--destructive-foreground'] = '#16171d'
  } else {
    vars['--destructive'] = vars['--danger']
    vars['--destructive-foreground'] = '#ffffff'
  }

  return vars
}

export function parseVsCodeTheme(raw: VsCodeThemeRaw, meta: ThemeMeta): AppTheme {
  const vars = workbenchToVars(raw)
  // Previously derived `.hljs-*` overrides from the theme's tokenColors -
  // code blocks are now fixed to GitHub Dark everywhere (see index.css), so
  // an imported theme no longer has anything to contribute here.
  return { meta, raw, vars, tokenCss: '' }
}
