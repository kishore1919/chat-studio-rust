import { useEffect, useState } from 'react'
import {
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-react'
import { useSettingsStore } from '../../store/settings'
import { ipc } from '../../lib/ipc'
import { ProviderIcon } from '../../lib/providerIcon'
import type { ProviderConfig } from '../../lib/types'
import { useCopyFeedback } from '../../lib/useCopyFeedback'
import { cn } from '@/lib/utils'
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
  const [copiedModel, copyModelId] = useCopyFeedback()
  const [lastCopiedId, setLastCopiedId] = useState<string | null>(null)

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
    copyModelId(id)
    setLastCopiedId(id)
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
                    {copiedModel && lastCopiedId === modelId ? (
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

export function ModelProviderPane() {
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
