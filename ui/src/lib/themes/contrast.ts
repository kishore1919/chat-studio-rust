/** WCAG 2.1 contrast helpers used to keep theme-derived text colors legible
 * against their background, regardless of what an imported VS Code theme's
 * `descriptionForeground`/`editor.foreground` happen to be. */

export function parseHex(hex: string): [number, number, number] | null {
  const h = hex.replace('#', '')
  if (h.length !== 6 && h.length !== 3) return null
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  if ([r, g, b].some((n) => Number.isNaN(n))) return null
  return [r, g, b]
}

function toHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')).join('')
}

function channelLuminance(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

export function contrastRatio(a: string, b: string): number | null {
  const rgbA = parseHex(a)
  const rgbB = parseHex(b)
  if (!rgbA || !rgbB) return null
  const lumA = relativeLuminance(rgbA)
  const lumB = relativeLuminance(rgbB)
  const lighter = Math.max(lumA, lumB)
  const darker = Math.min(lumA, lumB)
  return (lighter + 0.05) / (darker + 0.05)
}

export function mix(a: string, b: string, t: number): string {
  const rgbA = parseHex(a)
  const rgbB = parseHex(b)
  if (!rgbA || !rgbB) return a
  return toHex([
    rgbA[0] + (rgbB[0] - rgbA[0]) * t,
    rgbA[1] + (rgbB[1] - rgbA[1]) * t,
    rgbA[2] + (rgbB[2] - rgbA[2]) * t,
  ])
}

/** Walks `fg` away from `bg` (toward white or black, whichever direction
 * increases contrast) in steps until it clears `min` contrast, or returns
 * the most extreme step if it never quite gets there. Non-hex or unparsable
 * inputs pass through unchanged - callers only get contrast guarantees for
 * hex-valued theme colors. */
export function ensureContrast(fg: string, bg: string, min: number): string {
  const ratio = contrastRatio(fg, bg)
  if (ratio === null || ratio >= min) return fg

  const bgRgb = parseHex(bg)
  if (!bgRgb) return fg
  const target = relativeLuminance(bgRgb) > 0.5 ? '#000000' : '#ffffff'

  const steps = 12
  let best = fg
  let bestRatio = ratio
  for (let i = 1; i <= steps; i++) {
    const candidate = mix(fg, target, i / steps)
    const candidateRatio = contrastRatio(candidate, bg)
    if (candidateRatio === null) continue
    if (candidateRatio > bestRatio) {
      best = candidate
      bestRatio = candidateRatio
    }
    if (candidateRatio >= min) return candidate
  }
  return best
}
