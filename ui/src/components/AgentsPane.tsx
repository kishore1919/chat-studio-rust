import { useState } from 'react'
import {
  BotIcon,
  BrainIcon,
  CodeIcon,
  PlusIcon,
  SearchIcon,
  UserCheckIcon,
  ZapIcon,
  type LucideIcon,
} from 'lucide-react'
import { useSettingsStore } from '../store/settings'
import type { AgentConfig } from '../lib/types'
import { newId } from '../lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { PaneHeader } from './settings/PaneHeader'
import { SettingsCard } from './settings/SettingsCard'
import { CardActions } from './settings/CardActions'
import { PromptPreview } from './settings/PromptPreview'
import { PaneDialog } from './settings/PaneDialog'

const AGENT_ICONS: Record<string, LucideIcon> = {
  code: CodeIcon,
  search: SearchIcon,
  brain: BrainIcon,
  zap: ZapIcon,
  sparkles: ZapIcon,
}

function getAgentIcon(icon: string) {
  const Icon = AGENT_ICONS[icon] ?? BotIcon
  return <Icon className="size-4 text-primary" />
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
        id: newId('agent'),
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
      <PaneHeader
        title="Agents & Assistants"
        description="Configure specialized AI agents with tailored instructions, roles, and assigned skills."
      >
        <Button size="sm" onClick={openAdd} className="gap-1.5 text-xs">
          <PlusIcon className="size-3.5" /> Create Agent
        </Button>
      </PaneHeader>

      <div className="grid grid-cols-1 gap-3">
        {agents.map((agent) => (
          <SettingsCard key={agent.id}>
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
                <CardActions
                  onEdit={() => openEdit(agent)}
                  onDelete={() => handleDelete(agent.id)}
                  editTitle="Edit agent"
                  deleteTitle="Delete agent"
                />
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

            <PromptPreview>{agent.system_prompt}</PromptPreview>
          </SettingsCard>
        ))}
      </div>

      <PaneDialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editingAgent ? 'Edit Agent' : 'Create Agent'}
        description="Set up persona instructions, role, and assign modular skills."
        onSave={handleSave}
        saveLabel={editingAgent ? 'Save Agent' : 'Create Agent'}
        saveDisabled={!name.trim() || !systemPrompt.trim()}
      >
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
          <Textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="You are an expert Data Scientist. Always format analysis in structured markdown..."
            rows={4}
            className="min-h-0 px-3 py-1.5 text-xs shadow-xs"
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
      </PaneDialog>
    </div>
  )
}
