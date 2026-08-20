import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeftIcon,
  BotIcon,
  CableIcon,
  CheckIcon,
  CopyIcon,
  DatabaseIcon,
  EyeIcon,
  EyeOffIcon,
  FolderOpenIcon,
  MessageSquareTextIcon,
  PaletteIcon,
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
  Trash2Icon,
  UploadIcon,
  WandSparklesIcon,
  type LucideIcon,
} from 'lucide-react'
import { useSettingsStore } from '../store/settings'
import { useThemeStore } from '../store/theme'
import { ipc } from '../lib/ipc'
import { useDebouncedCallback } from '../lib/utils'
import { ProviderIcon } from '../lib/providerIcon'
import type { LastRequestInfo, ProviderConfig, Settings, ThemeMeta } from '../lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

import { McpPane } from '../components/McpPane'
import { SkillsPane } from '../components/SkillsPane'
import { AgentsPane } from '../components/AgentsPane'
import { PromptsPane } from '../components/PromptsPane'
import { FEATURES } from '../lib/features'

interface SettingsProps {
  onBack: () => void
}

type NavSection =
  | 'model-provider'
  | 'default-model'
  | 'agents'
  | 'skills'
  | 'prompts'
  | 'mcp'
  | 'appearance'
  | 'context'

const NAV_GROUPS: { label: string; items: { id: NavSection; label: string; icon: LucideIcon }[] }[] = [
  {
    label: 'Providers',
    items: [
      { id: 'model-provider', label: 'Model Provider', icon: CableIcon },
      { id: 'default-model', label: 'Default Model', icon: SparklesIcon },
    ],
  },
  {
    label: 'Agents & Skills',
    items: [
      // Gated behind lib/features.ts until each has real backend wiring
      // (both now apply via `set_conversation_system_prompt`). Prompts has
      // no flag - it's a real feature from the start.
      ...(FEATURES.agents ? [{ id: 'agents' as const, label: 'Agents & Assistants', icon: BotIcon }] : []),
      ...(FEATURES.skills ? [{ id: 'skills' as const, label: 'Skills', icon: WandSparklesIcon }] : []),
      { id: 'prompts', label: 'Prompts', icon: MessageSquareTextIcon },
      { id: 'mcp', label: 'MCP Servers', icon: PlugIcon },
    ],
  },
  {
    label: 'Preferences',
    items: [
      { id: 'appearance', label: 'Appearance', icon: PaletteIcon },
      { id: 'context', label: 'Context', icon: DatabaseIcon },
    ],
  },
]

export function Settings({ onBack }: SettingsProps) {
  const [section, setSection] = useState<NavSection>('model-provider')
  const settings = useSettingsStore((s) => s.settings)
  const load = useSettingsStore((s) => s.load)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (!settings) load()
  }, [settings, load])

  useEffect(() => {
    // App.tsx swaps routes by conditional render with no router - without
    // this, focus lands on <body> on every navigation into Settings.
    headingRef.current?.focus()
  }, [])

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/40 px-3">
        <Button variant="ghost" size="sm" onClick={onBack} aria-label="Back to chat" className="text-xs font-medium text-foreground">
          <ArrowLeftIcon /> Back
        </Button>
        <h1 ref={headingRef} tabIndex={-1} className="text-[13px] font-semibold tracking-tight text-foreground outline-none">
          Settings
        </h1>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="w-52 shrink-0 overflow-y-auto border-r border-border px-2 py-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-3.5">
              <div className="px-2 pb-1.5 text-[11px] font-bold tracking-wider text-foreground/80 uppercase">
                {group.label}
              </div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                  aria-current={section === item.id ? 'page' : undefined}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[13px] font-semibold transition-colors',
                    section === item.id
                      ? 'border-primary/40 bg-primary/20 font-bold text-primary shadow-xs'
                      : 'border-transparent text-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <item.icon className="size-3.5 shrink-0" aria-hidden="true" />
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
          {section === 'model-provider' ? (
            <div className="h-full">
              <ModelProviderPane />
            </div>
          ) : (
            <div className="mx-auto max-w-3xl h-full">
              {section === 'default-model' && <DefaultModelPane />}
              {section === 'agents' && <AgentsPane />}
              {section === 'skills' && <SkillsPane />}
              {section === 'prompts' && <PromptsPane />}
              {section === 'mcp' && <McpPane />}
              {section === 'appearance' && <AppearancePane />}
              {section === 'context' && <ContextPane />}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function AddProviderDialog({ onAdd }: { onAdd: (provider: ProviderConfig) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [dialect, setDialect] = useState<ProviderConfig['dialect']>('openai_compat')

  const handleAdd = () => {
    if (!name.trim() || !baseUrl.trim()) return
    onAdd({
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      display_name: name.trim(),
      dialect,
      base_url: baseUrl.trim(),
      api_key: '',
      enabled: true,
      extra_headers: {},
      models: [],
      disable_stream_options: false,
    })
    setName('')
    setBaseUrl('')
    setDialect('openai_compat')
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" className="m-2 h-8 gap-1.5" onClick={() => setOpen(true)}>
        <PlusIcon className="size-3.5" /> Add Provider
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Provider</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider-name" className="text-xs">Name</Label>
            <Input
              id="provider-name"
              placeholder="e.g. My Provider"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Dialect</Label>
            <Select value={dialect} onValueChange={(v) => setDialect(v as ProviderConfig['dialect'])}>
              <SelectTrigger className="w-full text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="openai_compat">OpenAI Compatible</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="gemini">Gemini</SelectItem>
                <SelectItem value="ollama">Ollama</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider-url" className="text-xs">API Base URL</Label>
            <Input
              id="provider-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!name.trim() || !baseUrl.trim()}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ModelProviderPane() {
  const settings = useSettingsStore((s) => s.settings)
  const addProvider = useSettingsStore((s) => s.addProvider)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const providers = settings?.providers ?? []
  const filtered = providers.filter((p) =>
    p.display_name.toLowerCase().includes(search.toLowerCase()),
  )
  const selected = providers.find((p) => p.id === selectedId) ?? filtered[0] ?? null

  return (
    <div className="flex h-full">
      <div className="flex w-56 shrink-0 flex-col border-r border-border pr-2">
        <div className="mb-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search providers..."
            aria-label="Search providers"
            className="h-8 text-xs"
          />
        </div>
        <div className="flex-1 overflow-y-auto space-y-0.5">
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedId(p.id)}
              aria-current={p.id === selected?.id ? 'true' : undefined}
              className={cn(
                'flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-left text-[13px] transition-colors',
                p.id === selected?.id
                  ? 'border-primary/40 bg-primary/20 font-bold text-primary shadow-xs'
                  : 'border-transparent text-foreground font-semibold hover:bg-accent hover:text-foreground',
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <ProviderIcon dialect={p.dialect} className="size-3.5 shrink-0" />
                <span className="truncate">{p.display_name}</span>
              </span>
              {p.enabled && <span className="ml-1 size-1.5 shrink-0 rounded-full bg-[var(--success)]" />}
            </button>
          ))}
        </div>
        <AddProviderDialog onAdd={addProvider} />
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto px-6">
        <div className="mx-auto max-w-2xl">
          {selected ? <ProviderDetail provider={selected} /> : <p className="text-muted-foreground text-xs">No provider selected</p>}
        </div>
      </div>
    </div>
  )
}

function ProviderDetail({ provider }: { provider: ProviderConfig }) {
  const settings = useSettingsStore((s) => s.settings)
  const save = useSettingsStore((s) => s.save)
  const removeProvider = useSettingsStore((s) => s.removeProvider)
  const modelsByProvider = useSettingsStore((s) => s.modelsByProvider)
  const refreshModels = useSettingsStore((s) => s.refreshModels)

  const [apiKey, setApiKey] = useState(provider.api_key)
  const [baseUrl, setBaseUrl] = useState(provider.base_url)
  const [showKey, setShowKey] = useState(false)
  const [modelSearch, setModelSearch] = useState('')
  const [customModelId, setCustomModelId] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [copiedModel, setCopiedModel] = useState<string | null>(null)

  const addedModels = provider.models ?? []

  useEffect(() => {
    setApiKey(provider.api_key)
    setBaseUrl(provider.base_url)
    setTestResult(null)
  }, [provider.id, provider.api_key, provider.base_url])

  const models = modelsByProvider[provider.id] ?? []
  const filteredModels = models.filter((m) =>
    m.display_name.toLowerCase().includes(modelSearch.toLowerCase()) ||
    m.id.toLowerCase().includes(modelSearch.toLowerCase()),
  )

  const persist = async (patch: Partial<ProviderConfig>) => {
    if (!settings) return
    const nextProviders = settings.providers.map((p) =>
      p.id === provider.id ? { ...p, ...patch } : p,
    )
    await save({ ...settings, providers: nextProviders })
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    await persist({ api_key: apiKey, base_url: baseUrl })
    try {
      const result = await ipc.testProvider(provider.id)
      setTestResult({
        ok: result.ok,
        message: result.ok
          ? `Connected · ${result.models_found} models available`
          : result.message || 'Connection failed',
      })
    } catch {
      setTestResult({ ok: false, message: 'Failed to test connection' })
    } finally {
      setTesting(false)
    }
  }

  const handleCopyModel = (id: string) => {
    navigator.clipboard.writeText(id)
    setCopiedModel(id)
    setTimeout(() => setCopiedModel(null), 2000)
  }

  const handleAddModel = (modelId: string) => {
    const trimmed = modelId.trim()
    if (!trimmed) return
    if (!addedModels.includes(trimmed)) {
      persist({ models: [...addedModels, trimmed] })
    }
    setCustomModelId('')
  }

  const handleRemoveModel = (modelId: string) => {
    persist({ models: addedModels.filter((id) => id !== modelId) })
  }

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2.5">
          <ProviderIcon dialect={provider.dialect} className="size-6" />
          <div>
            <h2 className="text-base font-semibold text-foreground">{provider.display_name}</h2>
            <span className="text-[11px] text-muted-foreground font-mono">Dialect: {provider.dialect}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={provider.enabled} onCheckedChange={(checked) => persist({ enabled: checked })} />
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={() => removeProvider(provider.id)}
            title="Delete provider"
          >
            <Trash2Icon className="size-3.5" />
          </Button>
        </div>
      </div>

      <div>
        <Label className="mb-1 block text-xs text-muted-foreground">API Key</Label>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1">
          <Input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onBlur={() => persist({ api_key: apiKey })}
            className="h-7 flex-1 border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-0"
          />
          <Button variant="ghost" size="icon-sm" className="size-6" onClick={() => setShowKey((v) => !v)} title="Reveal">
            {showKey ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={testing}
            className="h-6 px-2 text-[11px]"
          >
            {testing ? 'Testing...' : 'Test'}
          </Button>
        </div>
      </div>

      <div>
        <Label className="mb-1 block text-xs text-muted-foreground">API Host</Label>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          onBlur={() => persist({ base_url: baseUrl })}
          className="h-8 text-xs"
        />
      </div>

      {testResult && (
        <div
          className={cn(
            'rounded-md px-3 py-1.5 text-xs',
            testResult.ok
              ? 'bg-[var(--success)]/10 text-success'
              : 'bg-destructive/10 text-destructive',
          )}
        >
          {testResult.message}
        </div>
      )}

      {/* Active Models (Showing in Top Bar) */}
      <div className="rounded-lg border border-border/80 bg-card p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-foreground">
            Added Models ({addedModels.length})
          </span>
          <span className="text-[10px] text-muted-foreground">Shows in Top Bar</span>
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={customModelId}
            onChange={(e) => setCustomModelId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddModel(customModelId)}
            placeholder="Type a model ID to add (e.g. gpt-4o, deepseek-r1)..."
            className="h-7 text-xs font-mono"
          />
          <Button
            size="sm"
            onClick={() => handleAddModel(customModelId)}
            disabled={!customModelId.trim()}
            className="h-7 px-3 text-xs shrink-0"
          >
            <PlusIcon className="size-3 mr-1" /> Add
          </Button>
        </div>

        <div className="max-h-40 overflow-y-auto rounded-md border border-border/60 divide-y divide-border/40">
          {addedModels.length === 0 ? (
            <p className="p-2.5 text-center text-xs text-muted-foreground">
              No models added yet. Add models above or pick from catalog below.
            </p>
          ) : (
            addedModels.map((modelId) => (
              <div key={modelId} className="flex items-center justify-between px-2.5 py-1.5 text-xs">
                <span className="font-mono text-[11px] text-foreground truncate">{modelId}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleCopyModel(modelId)}
                    className="size-6 text-muted-foreground hover:text-foreground"
                    title="Copy Model ID"
                  >
                    {copiedModel === modelId ? (
                      <CheckIcon className="size-3 text-success" />
                    ) : (
                      <CopyIcon className="size-3" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleRemoveModel(modelId)}
                    className="size-6 text-muted-foreground hover:text-destructive"
                    title="Remove from top bar"
                  >
                    <Trash2Icon className="size-3" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Available Models from Provider Catalog */}
      <div className="pt-1">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-foreground">
            Provider Catalog ({models.length})
          </span>
          <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={() => refreshModels(provider.id, true)}>
            <RefreshCwIcon className="size-3 mr-1" /> Fetch Catalog
          </Button>
        </div>
        <Input
          value={modelSearch}
          onChange={(e) => setModelSearch(e.target.value)}
          placeholder="Search catalog to add..."
          className="mb-2 h-7 text-xs"
        />
        <div className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border/60">
          {filteredModels.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground text-center">
              {models.length === 0 ? 'Click "Fetch Catalog" to load provider models.' : 'No matching models.'}
            </p>
          ) : (
            filteredModels.map((m) => {
              const isAdded = addedModels.includes(m.id)
              return (
                <div key={m.id} className="flex items-center justify-between px-3 py-1.5 text-xs hover:bg-muted/40 transition-colors">
                  <div className="min-w-0 pr-2">
                    <div className="truncate font-medium text-foreground">{m.display_name}</div>
                    <div className="truncate text-[10px] text-muted-foreground font-mono">{m.id}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isAdded ? (
                      <span className="rounded bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
                        Added
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => handleAddModel(m.id)}
                      >
                        <PlusIcon className="size-3 mr-1" /> Add
                      </Button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

function DefaultModelPane() {
  const settings = useSettingsStore((s) => s.settings)
  const save = useSettingsStore((s) => s.save)
  const modelsByProvider = useSettingsStore((s) => s.modelsByProvider)

  if (!settings) return null
  const enabledProviders = settings.providers.filter((p) => p.enabled)

  return (
    <div className="max-w-md space-y-3">
      <h2 className="text-base font-semibold text-foreground">Default Model</h2>
      <div>
        <Label className="mb-1 block text-xs text-muted-foreground">Provider</Label>
        <Select
          value={settings.default_provider ?? ''}
          onValueChange={(value) => save({ ...settings, default_provider: value })}
        >
          <SelectTrigger className="w-full text-xs">
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            {enabledProviders.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <span className="flex items-center gap-1.5">
                  <ProviderIcon dialect={p.dialect} className="size-3.5" />
                  {p.display_name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="mb-1 block text-xs text-muted-foreground">Model</Label>
        <Input
          value={settings.default_model ?? ''}
          onChange={(e) => save({ ...settings, default_model: e.target.value })}
          list="default-model-suggestions"
          placeholder="Type a model id, e.g. gpt-4o-mini"
          className="text-xs font-mono"
        />
        <datalist id="default-model-suggestions">
          {(modelsByProvider[settings.default_provider ?? ''] ?? []).map((m) => (
            <option key={m.id} value={m.id} />
          ))}
        </datalist>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Type the model id directly, or pick from suggestions loaded from the provider.
        </p>
      </div>
    </div>
  )
}


const THEME_OPTIONS = [
  { id: 'light' as const, label: 'Light' },
  { id: 'dark' as const, label: 'Dark' },
  { id: 'system' as const, label: 'System' },
]

// First entry is the palette's own default green - kept here (rather than
// just relying on "Reset") so it still shows as a selectable, highlighted
// swatch when no override is set.
const ACCENT_SWATCHES = ['#3fd55a', '#2461e9', '#f04546', '#f59f05', '#66df7e']

function AppearancePane() {
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

function ContextPane() {
  const settings = useSettingsStore((s) => s.settings)
  const setLocalSettings = useSettingsStore((s) => s.setLocalSettings)
  const [lastRequest, setLastRequest] = useState<LastRequestInfo | null>(null)

  const debouncedPersist = useDebouncedCallback((next: Settings) => {
    void ipc.saveSettings(next)
  }, 250)
  const applyLive = (next: Settings) => {
    setLocalSettings(next)
    debouncedPersist(next)
  }

  useEffect(() => {
    let cancelled = false
    const poll = () => {
      ipc
        .getLastRequest()
        .then((r) => {
          if (!cancelled) setLastRequest(r)
        })
        .catch(() => {
          // Advisory only - a failed poll just leaves the last known snapshot.
        })
    }
    poll()
    const id = setInterval(poll, 2000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  if (!settings) return null

  return (
    <div className="max-w-2xl space-y-5">
      <h2 className="text-base font-semibold text-foreground">Context</h2>

      <div className="rounded-lg border border-border/60 bg-card p-3">
        <div className="mb-1 flex items-center justify-between">
          <Label htmlFor="context-tokens" className="text-xs font-medium text-foreground">
            Context window budget
          </Label>
          <Input
            id="context-tokens"
            type="number"
            min={1024}
            step={1024}
            value={settings.context_tokens}
            onChange={(e) => {
              const context_tokens = Math.max(1024, Number(e.target.value) || 0)
              applyLive({ ...settings, context_tokens })
            }}
            className="h-7 w-28 text-right text-xs"
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          How much conversation history (in tokens) is sent with each request. This is an
          estimate, not an exact tokenizer count - no tokenizer is bundled, so a conservative
          characters-per-token proxy is used instead. When a conversation grows past this
          budget, the oldest messages are dropped first; pin a message to always keep it, or
          exclude one to keep it out of every request.
        </p>
      </div>

      <div className="rounded-lg border border-border/60 bg-card p-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="memory-enabled" className="text-xs font-medium text-foreground">
              Rolling memory
            </Label>
            <p className="mt-1 text-[11px] text-muted-foreground">
              When history exceeds the budget, have the conversation's own provider compress the
              oldest turns into a summary instead of dropping them silently. The summary is
              injected into later requests so the model can still answer about earlier turns.
            </p>
          </div>
          <Switch
            id="memory-enabled"
            checked={settings.memory_enabled}
            onCheckedChange={(checked) => applyLive({ ...settings, memory_enabled: checked })}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border/60 bg-card p-3">
        <p className="mb-2 text-xs font-medium text-foreground">Last request</p>
        {lastRequest ? (
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>
              Conversation #{lastRequest.conversation_id} · {lastRequest.provider_id} /{' '}
              {lastRequest.model}
            </p>
            <p>
              {lastRequest.message_roles.length} messages sent · {lastRequest.used_tokens} /{' '}
              {lastRequest.budget_tokens} tokens used
            </p>
            {lastRequest.dropped_count > 0 && (
              <p className="text-amber-500">
                {lastRequest.dropped_count} earlier message
                {lastRequest.dropped_count === 1 ? '' : 's'} dropped to fit the budget
              </p>
            )}
            <p className="break-all font-mono text-[10px]">
              {lastRequest.message_roles.join(' → ')}
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            No request sent yet this session.
          </p>
        )}
      </div>
    </div>
  )
}
