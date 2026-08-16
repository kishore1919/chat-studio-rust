import { useState } from 'react'
import {
  BoxesIcon,
  CheckIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  ServerIcon,
  Trash2Icon,
  WrenchIcon,
  XCircleIcon,
} from 'lucide-react'
import { useSettingsStore } from '../store/settings'
import { ipc } from '../lib/ipc'
import type { McpServerConfig, McpTool } from '../lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const MCP_PRESETS: { name: string; command: string; args: string[]; desc: string }[] = [
  {
    name: 'Filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    desc: 'Provides secure read/write file access within allowed folders.',
  },
  {
    name: 'Fetch / Web Reader',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    desc: 'Enables web scraping and content fetching via HTTP.',
  },
  {
    name: 'Memory',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    desc: 'Knowledge graph-based persistent memory.',
  },
  {
    name: 'SQLite',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite', '--db-path', './data.db'],
    desc: 'Query and explore local SQLite databases.',
  },
]

export function McpPane() {
  const settings = useSettingsStore((s) => s.settings)
  const save = useSettingsStore((s) => s.save)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null)

  const [name, setName] = useState('')
  const [command, setCommand] = useState('npx')
  const [argsStr, setArgsStr] = useState('')
  const [envStr, setEnvStr] = useState('')

  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; tools?: McpTool[]; error?: string }>>({})

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
      const tools = await ipc.testMcpServer(server.command, server.args, server.env)
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

  const handleApplyPreset = (preset: typeof MCP_PRESETS[0]) => {
    setName(preset.name)
    setCommand(preset.command)
    setArgsStr(preset.args.join(' '))
  }

  const openAdd = () => {
    setEditingServer(null)
    setName('')
    setCommand('npx')
    setArgsStr('')
    setEnvStr('')
    setModalOpen(true)
  }

  const openEdit = (server: McpServerConfig) => {
    setEditingServer(server)
    setName(server.name)
    setCommand(server.command)
    setArgsStr(server.args.join(' '))
    const envLines = Object.entries(server.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
    setEnvStr(envLines)
    setModalOpen(true)
  }

  const handleSaveServer = () => {
    if (!settings || !name.trim() || !command.trim()) return

    const args = argsStr
      .trim()
      .split(/\s+/)
      .filter((a) => a.length > 0)

    const env: Record<string, string> = {}
    if (envStr.trim()) {
      for (const line of envStr.split('\n')) {
        const [k, ...v] = line.split('=')
        if (k && v.length > 0) {
          env[k.trim()] = v.join('=').trim()
        }
      }
    }

    if (editingServer) {
      const updated = servers.map((s) =>
        s.id === editingServer.id
          ? {
              ...s,
              name: name.trim(),
              command: command.trim(),
              args,
              env,
            }
          : s,
      )
      save({ ...settings, mcp_servers: updated })
    } else {
      const newServer: McpServerConfig = {
        id: `mcp-${Date.now()}`,
        name: name.trim(),
        command: command.trim(),
        args,
        env,
        enabled: true,
      }
      save({ ...settings, mcp_servers: [...servers, newServer] })
    }

    setModalOpen(false)
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Model Context Protocol (MCP)</h2>
          <p className="text-xs text-muted-foreground">
            Connect local and remote tools, filesystem connectors, APIs, and databases via MCP stdio servers.
          </p>
        </div>
        <Button size="sm" onClick={openAdd} className="gap-1.5 text-xs">
          <PlusIcon className="size-3.5" /> Add MCP Server
        </Button>
      </div>

      {/* Server List */}
      <div className="space-y-3">
        {servers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <ServerIcon className="mx-auto size-8 text-muted-foreground/50 mb-2" />
            <p className="text-xs text-muted-foreground font-medium">No MCP servers added yet.</p>
            <p className="text-[11px] text-muted-foreground/70 mt-1">
              Add servers like Filesystem, Fetch, or custom tools to empower the model with real-time abilities.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={openAdd}
              className="mt-3 text-xs"
            >
              <PlusIcon className="size-3.5 mr-1" /> Add your first server
            </Button>
          </div>
        ) : (
          servers.map((server) => {
            const isTesting = testingId === server.id
            const result = testResults[server.id]
            return (
              <div
                key={server.id}
                className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-xs transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <ServerIcon className="size-4" />
                    </div>
                    <div>
                      <div className="font-semibold text-foreground">{server.name}</div>
                      <div className="font-mono text-[11px] text-muted-foreground truncate max-w-md">
                        {server.command} {server.args.join(' ')}
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

                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openEdit(server)}
                      className="size-7 text-muted-foreground hover:text-foreground"
                      title="Edit server configuration"
                    >
                      <PencilIcon className="size-3.5" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleDelete(server.id)}
                      className="size-7 text-muted-foreground hover:text-destructive"
                      title="Remove server"
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
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
              </div>
            )
          })
        )}
      </div>

      {/* Add / Edit Server Dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingServer ? 'Edit MCP Server' : 'Add MCP Server'}</DialogTitle>
            <DialogDescription>
              Configure an MCP server executable to run via stdio.
            </DialogDescription>
          </DialogHeader>

          {/* Quick Presets */}
          {!editingServer && (
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
            </div>
          )}

          <div className="space-y-3 pt-1">
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

            <div className="space-y-1">
              <Label className="text-xs">Environment Variables (KEY=VALUE per line)</Label>
              <textarea
                value={envStr}
                onChange={(e) => setEnvStr(e.target.value)}
                placeholder="API_KEY=xyz&#10;DEBUG=1"
                rows={2}
                className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-xs font-mono shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveServer} disabled={!name.trim() || !command.trim()}>
              {editingServer ? 'Save Changes' : 'Add Server'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
