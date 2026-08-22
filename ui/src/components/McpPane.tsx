import { useState } from 'react'
import {
  BoxesIcon,
  CheckIcon,
  GlobeIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  ServerIcon,
  TerminalIcon,
  WrenchIcon,
  XCircleIcon,
} from 'lucide-react'
import { useSettingsStore } from '../store/settings'
import { ipc } from '../lib/ipc'
import type { McpServerConfig, McpTool } from '../lib/types'
import { newId } from '../lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { PaneHeader } from './settings/PaneHeader'
import { SettingsCard } from './settings/SettingsCard'
import { CardActions } from './settings/CardActions'
import { PaneDialog } from './settings/PaneDialog'

type McpPreset = {
  name: string
  transport: McpServerConfig['transport']
  command?: string
  args?: string[]
  url?: string
  desc: string
}

const MCP_PRESETS: McpPreset[] = [
  {
    name: 'Filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    desc: 'Provides secure read/write file access within allowed folders.',
  },
  {
    name: 'Fetch / Web Reader',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    desc: 'Enables web scraping and content fetching via HTTP.',
  },
  {
    name: 'Memory',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    desc: 'Knowledge graph-based persistent memory.',
  },
  {
    name: 'SQLite',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite', '--db-path', './data.db'],
    desc: 'Query and explore local SQLite databases.',
  },
]

const HTTP_PRESETS: McpPreset[] = [
  {
    name: 'Custom HTTP',
    transport: 'http',
    url: 'http://localhost:3000/mcp',
    desc: 'Streamable HTTP MCP endpoint on your own server.',
  },
]

function parseEnvString(input: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!input.trim()) return out
  for (const line of input.split('\n')) {
    const [k, ...v] = line.split('=')
    if (k && v.length > 0) {
      out[k.trim()] = v.join('=').trim()
    }
  }
  return out
}

function formatEnvString(env: Record<string, string>): string {
  return Object.entries(env ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
}

export function McpPane() {
  const settings = useSettingsStore((s) => s.settings)
  const save = useSettingsStore((s) => s.save)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null)

  const [name, setName] = useState('')
  const [transport, setTransport] = useState<McpServerConfig['transport']>('stdio')
  const [command, setCommand] = useState('npx')
  const [argsStr, setArgsStr] = useState('')
  const [envStr, setEnvStr] = useState('')
  const [url, setUrl] = useState('')
  const [headersStr, setHeadersStr] = useState('')

  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; tools?: McpTool[]; error?: string }>
  >({})

  const servers = settings?.mcp_servers ?? []

  const handleToggle = (id: string, enabled: boolean) => {
    if (!settings) return
    const next = {
      ...settings,
      mcp_servers: servers.map((s) => (s.id === id ? { ...s, enabled } : s)),
    }
    save(next)
  }

  const handleDelete = (id: string) => {
    if (!settings) return
    const next = {
      ...settings,
      mcp_servers: servers.filter((s) => s.id !== id),
    }
    save(next)
  }

  const handleTestServer = async (server: McpServerConfig) => {
    setTestingId(server.id)
    try {
      const tools = await ipc.testMcpServer(
        server.transport,
        server.command,
        server.args,
        server.env,
        server.url,
        server.headers,
      )
      setTestResults((prev) => ({
        ...prev,
        [server.id]: { ok: true, tools },
      }))
    } catch (e: unknown) {
      setTestResults((prev) => ({
        ...prev,
        [server.id]: { ok: false, error: String(e) },
      }))
    } finally {
      setTestingId(null)
    }
  }

  const handleApplyPreset = (preset: McpPreset) => {
    setName(preset.name)
    setTransport(preset.transport)
    setCommand(preset.command ?? 'npx')
    setArgsStr(preset.args?.join(' ') ?? '')
    setUrl(preset.url ?? '')
    setEnvStr('')
    setHeadersStr('')
  }

  const resetForm = () => {
    setName('')
    setTransport('stdio')
    setCommand('npx')
    setArgsStr('')
    setEnvStr('')
    setUrl('')
    setHeadersStr('')
  }

  const openAdd = () => {
    setEditingServer(null)
    resetForm()
    setModalOpen(true)
  }

  const openEdit = (server: McpServerConfig) => {
    setEditingServer(server)
    setName(server.name)
    setTransport(server.transport ?? 'stdio')
    setCommand(server.command ?? 'npx')
    setArgsStr(server.args?.join(' ') ?? '')
    setEnvStr(formatEnvString(server.env ?? {}))
    setUrl(server.url ?? '')
    setHeadersStr(formatEnvString(server.headers ?? {}))
    setModalOpen(true)
  }

  const buildServerConfig = (): McpServerConfig | null => {
    if (!name.trim()) return null
    const base: McpServerConfig = {
      id: editingServer?.id ?? newId('mcp'),
      name: name.trim(),
      enabled: true,
      transport,
      command: command.trim(),
      args: argsStr
        .trim()
        .split(/\s+/)
        .filter((a) => a.length > 0),
      env: parseEnvString(envStr),
      url: url.trim(),
      headers: parseEnvString(headersStr),
    }
    if (transport === 'stdio' && !base.command) return null
    if (transport === 'http' && !base.url) return null
    return base
  }

  const handleSaveServer = () => {
    if (!settings) return
    const server = buildServerConfig()
    if (!server) return

    if (editingServer) {
      const updated = servers.map((s) => (s.id === editingServer.id ? server : s))
      save({ ...settings, mcp_servers: updated })
    } else {
      save({ ...settings, mcp_servers: [...servers, server] })
    }

    setModalOpen(false)
  }

  const isFormValid = name.trim() && (transport === 'stdio' ? command.trim() : url.trim())

  return (
    <div className="max-w-3xl space-y-6">
      <PaneHeader
        title="Model Context Protocol (MCP)"
        description="Connect local stdio servers or remote streamable HTTP MCP endpoints for tool calling."
      >
        <Button size="sm" onClick={openAdd} className="gap-1.5 text-xs">
          <PlusIcon className="size-3.5" /> Add MCP Server
        </Button>
      </PaneHeader>

      {/* Server List */}
      <div className="space-y-3">
        {servers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <ServerIcon className="mx-auto size-8 text-muted-foreground/50 mb-2" />
            <p className="text-xs text-muted-foreground font-medium">No MCP servers added yet.</p>
            <p className="text-[11px] text-muted-foreground/70 mt-1">
              Add stdio executables or streamable HTTP endpoints to give the model real-time tools.
            </p>
            <Button variant="outline" size="sm" onClick={openAdd} className="mt-3 text-xs">
              <PlusIcon className="size-3.5 mr-1" /> Add your first server
            </Button>
          </div>
        ) : (
          servers.map((server) => {
            const isTesting = testingId === server.id
            const result = testResults[server.id]
            const endpointLabel =
              server.transport === 'http'
                ? server.url
                : `${server.command} ${server.args.join(' ')}`
            return (
              <SettingsCard key={server.id}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      {server.transport === 'http' ? (
                        <GlobeIcon className="size-4" />
                      ) : (
                        <TerminalIcon className="size-4" />
                      )}
                    </div>
                    <div>
                      <div className="font-semibold text-foreground">{server.name}</div>
                      <div className="flex items-center gap-1.5">
                        <span className="rounded bg-muted px-1 py-0.5 text-[10px] uppercase text-muted-foreground">
                          {server.transport}
                        </span>
                        <div className="font-mono text-[11px] text-muted-foreground truncate max-w-md">
                          {endpointLabel}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isTesting}
                      onClick={() => handleTestServer(server)}
                      className="h-7 text-[11px] gap-1 px-2.5"
                    >
                      {isTesting ? (
                        <Loader2Icon className="size-3 animate-spin" />
                      ) : (
                        <RefreshCwIcon className="size-3" />
                      )}
                      <span>Test & List Tools</span>
                    </Button>

                    <Switch
                      checked={server.enabled}
                      onCheckedChange={(checked) => handleToggle(server.id, checked)}
                    />

                    <CardActions
                      onEdit={() => openEdit(server)}
                      onDelete={() => handleDelete(server.id)}
                      editTitle="Edit server configuration"
                      deleteTitle="Remove server"
                    />
                  </div>
                </div>

                {/* Test Result / Tools Output */}
                {result && (
                  <div className="mt-1 rounded-lg border border-border/60 bg-muted/40 p-2.5">
                    {result.ok ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1 text-[11px] text-success font-medium">
                          <CheckIcon className="size-3" />
                          <span>Connected · {result.tools?.length ?? 0} tools available</span>
                        </div>
                        {result.tools && result.tools.length > 0 && (
                          <div className="grid grid-cols-2 gap-1.5 pt-1">
                            {result.tools.map((t) => (
                              <div
                                key={t.name}
                                className="flex items-start gap-1.5 rounded border border-border/40 bg-card p-1.5"
                              >
                                <WrenchIcon className="size-3 text-primary shrink-0 mt-0.5" />
                                <div className="min-w-0">
                                  <div className="font-mono font-medium text-[11px] truncate">
                                    {t.name}
                                  </div>
                                  {t.description && (
                                    <div className="text-[10px] text-muted-foreground line-clamp-1">
                                      {t.description}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-start gap-1.5 text-[11px] text-destructive">
                        <XCircleIcon className="size-3.5 shrink-0 mt-0.5" />
                        <span className="break-all">{result.error}</span>
                      </div>
                    )}
                  </div>
                )}
              </SettingsCard>
            )
          })
        )}
      </div>

      <PaneDialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editingServer ? 'Edit MCP Server' : 'Add MCP Server'}
        description="Configure an MCP server via stdio command or streamable HTTP endpoint."
        onSave={handleSaveServer}
        saveLabel={editingServer ? 'Save Changes' : 'Add Server'}
        saveDisabled={!isFormValid}
        beforeFields={
          !editingServer && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Quick Presets</Label>
              <div className="flex flex-wrap gap-1.5">
                {MCP_PRESETS.map((preset) => (
                  <Button
                    key={preset.name}
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => handleApplyPreset(preset)}
                    className="h-6.5 text-[11px] px-2"
                  >
                    <BoxesIcon className="size-3 mr-1 text-primary" />
                    {preset.name}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {HTTP_PRESETS.map((preset) => (
                  <Button
                    key={preset.name}
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => handleApplyPreset(preset)}
                    className="h-6.5 text-[11px] px-2"
                  >
                    <GlobeIcon className="size-3 mr-1 text-primary" />
                    {preset.name}
                  </Button>
                ))}
              </div>
            </div>
          )
        }
      >
        <div className="space-y-1">
          <Label className="text-xs">Server Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Filesystem Connector"
            className="h-8 text-xs"
          />
        </div>

        <div className="space-y-1">
              <Label className="text-xs">Transport</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={transport === 'stdio' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTransport('stdio')}
                  className="h-7 text-[11px] gap-1"
                >
                  <TerminalIcon className="size-3" /> Stdio
                </Button>
                <Button
                  type="button"
                  variant={transport === 'http' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTransport('http')}
                  className="h-7 text-[11px] gap-1"
                >
                  <GlobeIcon className="size-3" /> HTTP
                </Button>
              </div>
            </div>

            {transport === 'stdio' ? (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Command</Label>
                  <Input
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="e.g. npx, uvx, python, node"
                    className="h-8 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Arguments (space-separated)</Label>
                  <Input
                    value={argsStr}
                    onChange={(e) => setArgsStr(e.target.value)}
                    placeholder="-y @modelcontextprotocol/server-filesystem C:\my-folder"
                    className="h-8 text-xs font-mono"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Endpoint URL</Label>
                  <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="http://localhost:3000/mcp"
                    className="h-8 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Custom Headers (KEY=VALUE per line)</Label>
                  <Textarea
                    value={headersStr}
                    onChange={(e) => setHeadersStr(e.target.value)}
                    placeholder="Authorization=Bearer token&#10;X-Custom=foo"
                    rows={2}
                    className="min-h-0 px-3 py-1.5 text-xs font-mono shadow-xs"
                  />
                </div>
              </>
            )}

        <div className="space-y-1">
          <Label className="text-xs">Environment Variables (KEY=VALUE per line)</Label>
          <Textarea
            value={envStr}
            onChange={(e) => setEnvStr(e.target.value)}
            placeholder="API_KEY=xyz&#10;DEBUG=1"
            rows={2}
            className="min-h-0 px-3 py-1.5 text-xs font-mono shadow-xs"
          />
        </div>
      </PaneDialog>
    </div>
  )
}
