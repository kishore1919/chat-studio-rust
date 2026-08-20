import { useState } from 'react'
import {
  BotIcon,
  BrainIcon,
  CodeIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  UserCheckIcon,
  ZapIcon,
} from 'lucide-react'
import { useSettingsStore } from '../store/settings'
import type { AgentConfig } from '../lib/types'
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

function getAgentIcon(icon: string) {
  switch (icon) {
    case 'code':
      return <CodeIcon className="size-4 text-primary" />
    case 'search':
      return <SearchIcon className="size-4 text-primary" />
    case 'brain':
      return <BrainIcon className="size-4 text-primary" />
    case 'zap':
    case 'sparkles':
      return <ZapIcon className="size-4 text-primary" />
    default:
      return <BotIcon className="size-4 text-primary" />
  }
}


export function AgentsPane() {
  const settings = useSettingsStore((s) => s.settings)
  const save = useSettingsStore((s) => s.save)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null)

  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [description, setDescription] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [selectedSkills, setSelectedSkills] = useState<string[]>([])

  const agents = settings?.agents ?? []
  const availableSkills = settings?.skills ?? []

  const handleToggle = (id: string, enabled: boolean) => {
    if (!settings) return
    const next = {
      ...settings,
      agents: agents.map((a) => (a.id === id ? { ...a, enabled } : a)),
    }
    save(next)
  }

  const handleDelete = (id: string) => {
    if (!settings) return
    const next = {
      ...settings,
      agents: agents.filter((a) => a.id !== id),
    }
    save(next)
  }

  const openAdd = () => {
    setEditingAgent(null)
    setName('')
    setRole('')
    setDescription('')
    setSystemPrompt('')
    setSelectedSkills([])
    setModalOpen(true)
  }

  const openEdit = (agent: AgentConfig) => {
    setEditingAgent(agent)
    setName(agent.name)
    setRole(agent.role)
    setDescription(agent.description)
    setSystemPrompt(agent.system_prompt)
    setSelectedSkills(agent.skills ?? [])
    setModalOpen(true)
  }

  const handleSave = () => {
    if (!settings || !name.trim() || !systemPrompt.trim()) return

    if (editingAgent) {
      const updated = agents.map((a) =>
        a.id === editingAgent.id
          ? {
              ...a,
              name: name.trim(),
              role: role.trim(),
              description: description.trim(),
              system_prompt: systemPrompt.trim(),
              skills: selectedSkills,
            }
          : a,
      )
      save({ ...settings, agents: updated })
    } else {
      const newAgent: AgentConfig = {
        id: `agent-${Date.now()}`,
        name: name.trim(),
        role: role.trim() || 'AI Assistant',
        description: description.trim(),
        system_prompt: systemPrompt.trim(),
        provider: null,
        model: null,
        skills: selectedSkills,
        icon: 'bot',
        enabled: true,
      }
      save({ ...settings, agents: [...agents, newAgent] })
    }

    setModalOpen(false)
  }

  const toggleSkill = (skillId: string) => {
    setSelectedSkills((prev) =>
      prev.includes(skillId) ? prev.filter((id) => id !== skillId) : [...prev, skillId],
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Agents & Assistants</h2>
          <p className="text-xs text-muted-foreground">
            Configure specialized AI agents with tailored instructions, roles, and assigned skills.
          </p>
        </div>
        <Button size="sm" onClick={openAdd} className="gap-1.5 text-xs">
          <PlusIcon className="size-3.5" /> Create Agent
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-xs transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-2.5">
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
                  {getAgentIcon(agent.icon)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">{agent.name}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-medium">
                      {agent.role}
                    </span>
                  </div>
                  <div className="text-muted-foreground text-[11px] mt-0.5">
                    {agent.description}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={agent.enabled}
                  onCheckedChange={(checked) => handleToggle(agent.id, checked)}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => openEdit(agent)}
                  className="size-7 text-muted-foreground hover:text-foreground"
                  title="Edit agent"
                >
                  <PencilIcon className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => handleDelete(agent.id)}
                  className="size-7 text-muted-foreground hover:text-destructive"
                  title="Delete agent"
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            </div>

            {/* Attached Skills */}
            {agent.skills && agent.skills.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                <span className="text-[10px] text-muted-foreground">Skills:</span>
                {agent.skills.map((skillId) => {
                  const s = availableSkills.find((item) => item.id === skillId)
                  return (
                    <span
                      key={skillId}
                      className="inline-flex items-center gap-1 rounded bg-accent/60 px-1.5 py-0.5 text-[10px] text-accent-foreground font-medium"
                    >
                      <ZapIcon className="size-2.5 text-primary" />
                      {s ? s.name : skillId}
                    </span>
                  )
                })}
              </div>
            )}


            {/* Prompt preview */}
            <div className="rounded-lg bg-muted/40 p-2 text-[11px] font-mono text-muted-foreground line-clamp-2">
              {agent.system_prompt}
            </div>
          </div>
        ))}
      </div>

      {/* Add / Edit Agent Dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingAgent ? 'Edit Agent' : 'Create Agent'}</DialogTitle>
            <DialogDescription>
              Set up persona instructions, role, and assign modular skills.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 pt-1">
            <div className="space-y-1">
              <Label className="text-xs">Agent Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Data Scientist"
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Role / Title</Label>
              <Input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="e.g. Senior Data Analyst"
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Analyzes statistics, visualizes data, and builds machine learning models."
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">System Instructions & Prompt</Label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="You are an expert Data Scientist. Always format analysis in structured markdown..."
                rows={4}
                className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            {/* Assign Skills */}
            <div className="space-y-1.5">
              <Label className="text-xs">Attach Skills</Label>
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1 rounded-md border border-input/60">
                {availableSkills.map((s) => {
                  const active = selectedSkills.includes(s.id)
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleSkill(s.id)}
                      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors cursor-pointer ${
                        active
                          ? 'bg-primary text-primary-foreground font-medium'
                          : 'bg-muted text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      <UserCheckIcon className="size-3" />
                      {s.name}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!name.trim() || !systemPrompt.trim()}>
              {editingAgent ? 'Save Agent' : 'Create Agent'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
