import { useEffect, useState } from 'react'
import { FolderOpenIcon, Trash2Icon, UploadIcon } from 'lucide-react'
import { useSettingsStore } from '../../store/settings'
import { useThemeStore } from '../../store/theme'
import { ipc } from '../../lib/ipc'
import { useDebouncedCallback } from '../../lib/utils'
import type { Settings, ThemeMeta } from '../../lib/types'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

const THEME_OPTIONS = [
  { id: 'light' as const, label: 'Light' },
  { id: 'dark' as const, label: 'Dark' },
  { id: 'system' as const, label: 'System' },
]

// First entry is the palette's own default green - kept here (rather than
// just relying on "Reset") so it still shows as a selectable, highlighted
// swatch when no override is set.
const ACCENT_SWATCHES = ['#3fd55a', '#2461e9', '#f04546', '#f59f05', '#66df7e']

export function AppearancePane() {
  const settings = useSettingsStore((s) => s.settings)
  const save = useSettingsStore((s) => s.save)
  const setLocalSettings = useSettingsStore((s) => s.setLocalSettings)
  const themeId = useThemeStore((s) => s.themeId)

  const [themes, setThemes] = useState<ThemeMeta[]>([])
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    ipc.listThemes().then(setThemes).catch(() => {})
  }, [])

  // Applies on every tick for responsiveness; only the IPC write collapses to
  // the last value once the drag/slide stops for 250ms. Without this, a drag
  // fired a full `save_settings` round-trip (serializing the whole settings
  // file, ~244KB if skills are populated) per tick.
  const debouncedPersist = useDebouncedCallback((next: Settings) => {
    void ipc.saveSettings(next)
  }, 250)
  const applyLive = (next: Settings) => {
    setLocalSettings(next)
    debouncedPersist(next)
  }

  const handleSelect = async (id: 'light' | 'dark' | 'system') => {
    useThemeStore.getState().setThemeId(id)
    if (settings) await save({ ...settings, theme_id: id })
  }

  const handleAccentChange = async (accent: string | null) => {
    useThemeStore.getState().setAccent(accent)
    await save({ ...settings!, accent })
  }

  const handleImportTheme = async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      setImporting(true)
      try {
        const content = await file.text()
        const id = file.name.replace(/\.json$/i, '')
        await ipc.importThemeContent(id, content, false)
        const updated = await ipc.listThemes()
        setThemes(updated)
      } catch {
        // Import errors surface as the invoke rejection message
      } finally {
        setImporting(false)
      }
    }
    input.click()
  }

  const handleDeleteTheme = async (id: string) => {
    await ipc.deleteCustomTheme(id)
    setThemes((prev) => prev.filter((t) => t.id !== id))
  }

  if (!settings) return null

  return (
    <div className="max-w-2xl space-y-5">
      <h2 className="text-base font-semibold text-foreground">Appearance</h2>

      <div>
        <Label className="mb-2 block text-xs font-medium text-foreground">Theme</Label>
        <div className="flex gap-1.5">
          {THEME_OPTIONS.map((opt) => (
            <Button
              key={opt.id}
              variant={themeId === opt.id ? 'default' : 'outline'}
              size="sm"
              className="h-7 flex-1 text-xs"
              onClick={() => void handleSelect(opt.id)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border/60 bg-card p-3">
        <Label className="text-xs font-medium text-foreground">Accent</Label>
        <div className="flex items-center gap-2">
          {ACCENT_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => void handleAccentChange(c)}
              className={`size-6 shrink-0 rounded-full border-2 transition ${settings.accent === c || (!settings.accent && c === '#3fd55a') ? 'border-foreground scale-110' : 'border-border'}`}
              style={{ background: c }}
              title={c}
            />
          ))}
          <input
            type="color"
            value={settings.accent || '#3fd55a'}
            onChange={(e) => void handleAccentChange(e.target.value)}
            className="size-6 shrink-0 cursor-pointer rounded-full border border-border bg-transparent p-0"
            title="Pick accent color"
          />
          <span className="w-16 shrink-0 rounded border border-border/60 bg-background px-1.5 py-1 text-center font-mono text-[11px] text-muted-foreground uppercase">
            {settings.accent || '#3fd55a'}
          </span>
          {settings.accent && (
            <Button variant="ghost" size="sm" className="h-6 shrink-0 text-[11px]" onClick={() => void handleAccentChange(null)}>
              Reset
            </Button>
          )}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label className="text-xs font-medium text-foreground">Message font size</Label>
          <span className="text-xs font-mono text-muted-foreground">{settings.font_size}px</span>
        </div>
        <div className="relative flex items-center gap-3">
          <span className="shrink-0 text-xs text-muted-foreground">A</span>
          <div className="relative flex-1">
            <div className="pointer-events-none absolute inset-y-1/2 h-1.5 -translate-y-1/2 rounded-full bg-border/60 w-full" />
            <div
              className="pointer-events-none absolute inset-y-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary"
              style={{ width: `${((settings.font_size - 12) / 6) * 100}%` }}
            />
            <input
              type="range"
              min={12}
              max={18}
              step={1}
              value={settings.font_size}
              onChange={(e) => {
                const font_size = Number(e.target.value)
                useThemeStore.getState().setFontSize(font_size)
                applyLive({ ...settings, font_size })
              }}
              className="relative w-full appearance-none bg-transparent h-5 cursor-pointer [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:-mt-[5px] [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:shadow-sm"
            />
          </div>
          <span className="shrink-0 text-base text-muted-foreground">A</span>
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
          <span>12</span>
          <span className={`transition-colors ${settings.font_size === 16 ? 'font-medium text-primary' : ''}`}>Default (16)</span>
          <span>18</span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium text-foreground">Custom Themes</Label>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={handleImportTheme}
              disabled={importing}
            >
              <UploadIcon className="size-3" />
              Import VS Code Theme
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7 text-muted-foreground hover:text-foreground"
              onClick={() => void ipc.openThemesDir()}
              title="Open themes folder"
            >
              <FolderOpenIcon className="size-3.5" />
            </Button>
          </div>
        </div>
        {themes.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">
            No custom themes installed. Import a VS Code color theme (.json) to get started.
          </p>
        ) : (
          <div className="space-y-1">
            {themes.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-medium text-foreground truncate">{t.name}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {t.type}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-6 text-muted-foreground hover:text-destructive"
                  onClick={() => void handleDeleteTheme(t.id)}
                  title="Delete theme"
                >
                  <Trash2Icon className="size-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
