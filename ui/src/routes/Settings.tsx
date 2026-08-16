import { useEffect, useState } from 'react'
import { useSettingsStore } from '../store/settings'
import { ipc } from '../lib/ipc'
import type { ProviderConfig, ThemePreference } from '../lib/types'

interface SettingsProps {
  onBack: () => void
}

type NavSection = 'model-provider' | 'default-model' | 'appearance' | 'data'

const NAV_GROUPS: { label: string; items: { id: NavSection; label: string }[] }[] = [
  {
    label: 'Providers',
    items: [
      { id: 'model-provider', label: 'Model Provider' },
      { id: 'default-model', label: 'Default Model' },
    ],
  },
  {
    label: 'Preferences',
    items: [
      { id: 'appearance', label: 'Appearance' },
      { id: 'data', label: 'Data' },
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
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3">
        <button onClick={onBack} className="rounded px-2 py-1 hover:bg-[var(--bg-hover)]">
          ← Back
        </button>
        <span className="font-semibold">Settings</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="w-48 shrink-0 overflow-y-auto border-r border-[var(--border)] px-2 py-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-3">
              <div className="px-2 pb-1 text-[11px] font-medium text-[var(--text-muted)] uppercase">
                {group.label}
              </div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSection(item.id)}
                  className={`block w-full rounded-lg px-2 py-1.5 text-left text-[13px] ${
                    section === item.id ? 'bg-[var(--accent-bg)]' : 'hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          {section === 'model-provider' && <ModelProviderPane />}
          {section === 'default-model' && <DefaultModelPane />}
          {section === 'appearance' && <AppearancePane />}
          {section === 'data' && <DataPane />}
        </div>
      </div>
    </div>
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

  const handleAddProvider = () => {
    const displayName = prompt('Provider name')
    if (!displayName) return
    const baseUrl = prompt('API base URL (OpenAI-compatible, e.g. https://api.example.com/v1)')
    if (!baseUrl) return
    const provider: ProviderConfig = {
      id: displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      display_name: displayName,
      dialect: 'openai_compat',
      base_url: baseUrl,
      api_key: '',
      enabled: true,
      extra_headers: {},
    }
    addProvider(provider)
  }

  return (
    <div className="flex h-full">
      <div className="flex w-56 shrink-0 flex-col border-r border-[var(--border)]">
        <div className="p-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search providers..."
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[13px] outline-none"
          />
        </div>
        <div className="flex-1 overflow-y-auto px-2">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[13px] ${
                p.id === selected?.id ? 'bg-[var(--accent-bg)]' : 'hover:bg-[var(--bg-hover)]'
              }`}
            >
              <span>{p.display_name}</span>
              {p.enabled && <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />}
            </button>
          ))}
        </div>
        <button
          onClick={handleAddProvider}
          className="m-2 rounded-lg border border-[var(--border)] px-2 py-1.5 text-[13px] hover:bg-[var(--bg-hover)]"
        >
          + Add Provider
        </button>
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto p-4">
        {selected ? <ProviderDetail provider={selected} /> : <p className="text-[var(--text-muted)]">No provider selected</p>}
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
  const [testResult, setTestResult] = useState<string | null>(null)

  useEffect(() => {
    setApiKey(provider.api_key)
    setBaseUrl(provider.base_url)
    setTestResult(null)
  }, [provider.id, provider.api_key, provider.base_url])

  const models = modelsByProvider[provider.id] ?? []
  const filteredModels = models.filter((m) =>
    m.display_name.toLowerCase().includes(modelSearch.toLowerCase()),
  )

  const persist = async (patch: Partial<ProviderConfig>) => {
    if (!settings) return
    const nextProviders = settings.providers.map((p) =>
      p.id === provider.id ? { ...p, ...patch } : p,
    )
    await save({ ...settings, providers: nextProviders })
  }

  const handleTest = async () => {
    await persist({ api_key: apiKey, base_url: baseUrl })
    const result = await ipc.testProvider(provider.id)
    setTestResult(result.ok ? `Connected · ${result.models_found} models` : result.message)
  }

  return (
    <div className="max-w-xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{provider.display_name}</h2>
        <div className="flex items-center gap-2">
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={provider.enabled}
              onChange={(e) => persist({ enabled: e.target.checked })}
              className="peer sr-only"
            />
            <div className="h-5 w-9 rounded-full bg-[var(--border)] peer-checked:bg-[var(--success)]" />
          </label>
          <button
            onClick={() => removeProvider(provider.id)}
            className="text-[13px] text-[var(--danger)] hover:underline"
          >
            Remove
          </button>
        </div>
      </div>

      <label className="mb-1 block text-[13px] text-[var(--text-muted)]">API Key</label>
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1.5">
        <input
          type={showKey ? 'text' : 'password'}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onBlur={() => persist({ api_key: apiKey })}
          className="flex-1 bg-transparent text-[13px] outline-none"
        />
        <button onClick={() => setShowKey((v) => !v)} className="text-[var(--text-muted)]" title="Reveal">
          {showKey ? '🙈' : '👁'}
        </button>
        <button onClick={handleTest} className="text-[var(--text-muted)]" title="Test connection">
          ⚡
        </button>
      </div>

      <label className="mb-1 block text-[13px] text-[var(--text-muted)]">API Host</label>
      <input
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        onBlur={() => persist({ base_url: baseUrl })}
        className="mb-3 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[13px] outline-none"
      />

      {testResult && <p className="mb-3 text-[13px] text-[var(--text-muted)]">{testResult}</p>}

      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-medium">Models</span>
        <button
          onClick={() => refreshModels(provider.id, true)}
          className="rounded-lg border border-[var(--border)] px-2 py-1 text-[12px] hover:bg-[var(--bg-hover)]"
        >
          ↻ Get model list
        </button>
      </div>
      <input
        value={modelSearch}
        onChange={(e) => setModelSearch(e.target.value)}
        placeholder="Search models..."
        className="mb-2 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[13px] outline-none"
      />
      <div className="max-h-64 overflow-y-auto rounded-lg border border-[var(--border)]">
        {filteredModels.length === 0 ? (
          <p className="p-3 text-[13px] text-[var(--text-muted)]">
            No models loaded. Click "Get model list".
          </p>
        ) : (
          filteredModels.map((m) => (
            <div key={m.id} className="border-b border-[var(--border)] px-3 py-1.5 text-[13px] last:border-b-0">
              {m.display_name}
            </div>
          ))
        )}
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
    <div className="max-w-md p-4">
      <h2 className="mb-3 text-lg font-semibold">Default Model</h2>
      <label className="mb-1 block text-[13px] text-[var(--text-muted)]">Provider</label>
      <select
        value={settings.default_provider ?? ''}
        onChange={(e) => save({ ...settings, default_provider: e.target.value })}
        className="mb-3 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[13px]"
      >
        <option value="">None</option>
        {enabledProviders.map((p) => (
          <option key={p.id} value={p.id}>
            {p.display_name}
          </option>
        ))}
      </select>
      <label className="mb-1 block text-[13px] text-[var(--text-muted)]">Model</label>
      <input
        value={settings.default_model ?? ''}
        onChange={(e) => save({ ...settings, default_model: e.target.value })}
        list="default-model-suggestions"
        placeholder="Type a model id, e.g. gpt-4o-mini"
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[13px] outline-none"
      />
      <datalist id="default-model-suggestions">
        {(modelsByProvider[settings.default_provider ?? ''] ?? []).map((m) => (
          <option key={m.id} value={m.id} />
        ))}
      </datalist>
      <p className="mt-1 text-[12px] text-[var(--text-muted)]">
        Type the model id directly, or click "Get model list" on the provider's page first to pick
        from suggestions.
      </p>
    </div>
  )
}

function AppearancePane() {
  const settings = useSettingsStore((s) => s.settings)
  const save = useSettingsStore((s) => s.save)

  if (!settings) return null

  const setTheme = (theme: ThemePreference) => save({ ...settings, theme })

  return (
    <div className="max-w-md p-4">
      <h2 className="mb-3 text-lg font-semibold">Appearance</h2>
      <label className="mb-1 block text-[13px] text-[var(--text-muted)]">Theme</label>
      <div className="mb-4 flex gap-2">
        {(['light', 'dark', 'system'] as ThemePreference[]).map((t) => (
          <button
            key={t}
            onClick={() => setTheme(t)}
            className={`rounded-lg border px-3 py-1.5 text-[13px] capitalize ${
              settings.theme === t
                ? 'border-[var(--accent)] bg-[var(--accent-bg)]'
                : 'border-[var(--border)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <label className="mb-1 block text-[13px] text-[var(--text-muted)]">Font size</label>
      <input
        type="range"
        min={12}
        max={18}
        value={settings.font_size}
        onChange={(e) => save({ ...settings, font_size: Number(e.target.value) })}
        className="w-full"
      />
    </div>
  )
}

function DataPane() {
  return (
    <div className="max-w-md p-4">
      <h2 className="mb-3 text-lg font-semibold">Data</h2>
      <p className="mb-3 text-[13px] text-[var(--text-muted)]">
        API keys are stored unencrypted in the local settings file. Anyone with access to this
        computer's user account can read them.
      </p>
      <button
        onClick={() => ipc.openConfigDir()}
        className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[13px] hover:bg-[var(--bg-hover)]"
      >
        Open config folder
      </button>
    </div>
  )
}
