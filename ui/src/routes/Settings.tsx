import { useEffect, useState } from 'react'
import {
  ArrowLeftIcon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-react'
import { useSettingsStore } from '../store/settings'
import { ipc } from '../lib/ipc'
import type { ProviderConfig, ThemePreference } from '../lib/types'
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

interface SettingsProps {
  onBack: () => void
}

type NavSection = 'model-provider' | 'default-model' | 'agents' | 'skills' | 'mcp' | 'appearance'

const NAV_GROUPS: { label: string; items: { id: NavSection; label: string }[] }[] = [
  {
    label: 'Providers',
    items: [
      { id: 'model-provider', label: 'Model Provider' },
      { id: 'default-model', label: 'Default Model' },
    ],
  },
  {
    label: 'Agents & Skills',
    items: [
      { id: 'agents', label: 'Agents & Assistants' },
      { id: 'skills', label: 'Skills & Prompts' },
      { id: 'mcp', label: 'MCP Servers' },
    ],
  },
  {
    label: 'Preferences',
    items: [
      { id: 'appearance', label: 'Appearance' },
    ],
  },
]

export function Settings({ onBack }: SettingsProps) {
  const [section, setSection] = useState<NavSection>('model-provider')
  const settings = useSettingsStore((s) => s.settings)
  const load = useSettingsStore((s) => s.load)

  useEffect(() => {
    if (!settings) load()
  }, [settings, load])

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-xs">
          <ArrowLeftIcon /> Back
        </Button>
        <span className="font-semibold text-[13px]">Settings</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="w-48 shrink-0 overflow-y-auto border-r border-border px-2 py-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-3">
              <div className="px-2 pb-1 text-[11px] font-medium text-muted-foreground uppercase">
                {group.label}
              </div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSection(item.id)}
                  className={cn(
                    'block w-full rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors cursor-pointer',
                    section === item.id ? 'bg-accent font-medium text-foreground' : 'hover:bg-accent/60 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          {section === 'model-provider' && <ModelProviderPane />}
          {section === 'default-model' && <DefaultModelPane />}
          {section === 'agents' && <AgentsPane />}
          {section === 'skills' && <SkillsPane />}
          {section === 'mcp' && <McpPane />}
          {section === 'appearance' && <AppearancePane />}
        </div>
      </div>
    </div>
  )
}

function AddProviderDialog({ onAdd }: { onAdd: (provider: ProviderConfig) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')

  const handleAdd = () => {
    if (!name.trim() || !baseUrl.trim()) return
    onAdd({
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      display_name: name.trim(),
      dialect: 'openai_compat',
      base_url: baseUrl.trim(),
      api_key: '',
      enabled: true,
      extra_headers: {},
      models: [],
    })
    setName('')
    setBaseUrl('')
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" className="m-2" onClick={() => setOpen(true)}>
        <PlusIcon /> Add Provider
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
            <Label htmlFor="provider-url" className="text-xs">API Base URL</Label>
            <Input
              id="provider-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <p className="text-[11px] text-muted-foreground">Must be an OpenAI-compatible endpoint.</p>
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
            className="h-8 text-xs"
          />
        </div>
        <div className="flex-1 overflow-y-auto space-y-0.5">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={cn(
                'flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors',
                p.id === selected?.id ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              <span className="truncate">{p.display_name}</span>
              {p.enabled && <span className="size-1.5 rounded-full bg-[var(--success)] shrink-0 ml-1" />}
            </button>
          ))}
        </div>
        <AddProviderDialog onAdd={addProvider} />
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto pl-4">
        {selected ? <ProviderDetail provider={selected} /> : <p className="text-muted-foreground text-xs">No provider selected</p>}
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
    <div className="max-w-xl space-y-4">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{provider.display_name}</h2>
          <span className="text-[11px] text-muted-foreground font-mono">Dialect: {provider.dialect}</span>
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
                {p.display_name}
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

function AppearancePane() {
  const settings = useSettingsStore((s) => s.settings)
  const save = useSettingsStore((s) => s.save)

  if (!settings) return null

  const setTheme = (theme: ThemePreference) => save({ ...settings, theme })

  return (
    <div className="max-w-md space-y-4">
      <h2 className="text-base font-semibold text-foreground">Appearance</h2>
      <div>
        <Label className="mb-1.5 block text-xs text-muted-foreground">Theme</Label>
        <div className="flex gap-2">
          {(['light', 'dark', 'system'] as ThemePreference[]).map((t) => (
            <Button
              key={t}
              variant={settings.theme === t ? 'default' : 'outline'}
              size="sm"
              className="capitalize text-xs"
              onClick={() => setTheme(t)}
            >
              {t}
            </Button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Font size</Label>
          <span className="text-xs font-mono text-muted-foreground">{settings.font_size}px</span>
        </div>
        <input
          type="range"
          min={12}
          max={18}
          value={settings.font_size}
          onChange={(e) => save({ ...settings, font_size: Number(e.target.value) })}
          className="w-full accent-primary"
        />
      </div>
    </div>
  )
}
