import { useEffect, useState } from 'react'
import {
  BrainIcon,
  CodeIcon,
  FileTextIcon,
  FolderSyncIcon,
  GlobeIcon,
  LanguagesIcon,
  Loader2Icon,
  PlusIcon,
  WrenchIcon,
  ZapIcon,
  type LucideIcon,
} from 'lucide-react'
import { useSettingsStore } from '../store/settings'
import { ipc } from '../lib/ipc'
import type { Skill } from '../lib/types'
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

const SKILL_ICONS: Record<string, LucideIcon> = {
  code: CodeIcon,
  'file-text': FileTextIcon,
  brain: BrainIcon,
  languages: LanguagesIcon,
  globe: GlobeIcon,
  zap: ZapIcon,
}

function getSkillIcon(icon: string) {
  const Icon = SKILL_ICONS[icon] ?? WrenchIcon
  return <Icon className="size-4 text-primary" />
}


type FilterTab = 'all' | 'builtin' | 'global' | 'custom'

export function SkillsPane() {
  const settings = useSettingsStore((s) => s.settings)
  const save = useSettingsStore((s) => s.save)

  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null)
  const [scanning, setScanning] = useState(false)

  const [name, setName] = useState('')
  const [slashCommand, setSlashCommand] = useState('')
  const [description, setDescription] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')

  const skills = settings?.skills ?? []

  // Auto scan global skills on initial open if not scanned
  const handleScanGlobal = async () => {
    if (!settings) return
    setScanning(true)
    try {
      const globalSkills = await ipc.listGlobalSkills()
      if (globalSkills.length > 0) {
        // Merge without duplicate IDs
        const existingIds = new Set(skills.map((s) => s.id))
        const newToAdd = globalSkills.filter((gs) => !existingIds.has(gs.id))
        if (newToAdd.length > 0) {
          save({ ...settings, skills: [...skills, ...newToAdd] })
        }
      }
    } catch (err) {
      console.error('Failed to scan global skills:', err)
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => {
    // Scan global skills once on mount
    handleScanGlobal()
  }, [])

  const handleToggle = (id: string, enabled: boolean) => {
    if (!settings) return
    const next = {
      ...settings,
      skills: skills.map((s) => (s.id === id ? { ...s, enabled } : s)),
    }
    save(next)
  }

  const handleDelete = (id: string) => {
    if (!settings) return
    const next = {
      ...settings,
      skills: skills.filter((s) => s.id !== id),
    }
    save(next)
  }

  const openAdd = () => {
    setEditingSkill(null)
    setName('')
    setSlashCommand('')
    setDescription('')
    setSystemPrompt('')
    setModalOpen(true)
  }

  const openEdit = (skill: Skill) => {
    setEditingSkill(skill)
    setName(skill.name)
    setSlashCommand(skill.slash_command)
    setDescription(skill.description)
    setSystemPrompt(skill.system_prompt)
    setModalOpen(true)
  }

  const handleSaveSkill = () => {
    if (!settings || !name.trim() || !systemPrompt.trim()) return

    const cleanSlash = slashCommand.replace(/^\//, '').trim() || name.toLowerCase().replace(/\s+/g, '-')

    if (editingSkill) {
      const updated = skills.map((s) =>
        s.id === editingSkill.id
          ? {
              ...s,
              name: name.trim(),
              slash_command: cleanSlash,
              description: description.trim(),
              system_prompt: systemPrompt.trim(),
            }
          : s,
      )
      save({ ...settings, skills: updated })
    } else {
      const newSkill: Skill = {
        id: newId('skill'),
        name: name.trim(),
        slash_command: cleanSlash,
        description: description.trim(),
        system_prompt: systemPrompt.trim(),
        icon: 'wrench',
        enabled: true,
        source: 'custom',
        path: null,
      }
      save({ ...settings, skills: [...skills, newSkill] })
    }

    setModalOpen(false)
  }

  const filteredSkills = skills.filter((s) => {
    if (activeTab === 'all') return true
    if (activeTab === 'builtin') return s.source === 'builtin' || !s.source
    if (activeTab === 'global') return s.source === 'global'
    if (activeTab === 'custom') return s.source === 'custom'
    return true
  })

  return (
    <div className="max-w-3xl space-y-6">
      <PaneHeader
        title="Skills"
        description="Modular abilities and toolsets from built-ins, global directories (~/.agents, ~/.claude, ~/.gemini), and custom skills."
      >
        <Button
          variant="outline"
          size="sm"
          disabled={scanning}
          onClick={handleScanGlobal}
          className="gap-1.5 text-xs"
        >
          {scanning ? <Loader2Icon className="size-3.5 animate-spin" /> : <FolderSyncIcon className="size-3.5" />}
          Scan Global Skills
        </Button>
        <Button size="sm" onClick={openAdd} className="gap-1.5 text-xs">
          <PlusIcon className="size-3.5" /> Add Skill
        </Button>
      </PaneHeader>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 border-b border-border pb-2">
        <button
          onClick={() => setActiveTab('all')}
          className={`rounded-md px-2.5 py-1 text-xs transition-colors cursor-pointer ${
            activeTab === 'all' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-accent'
          }`}
        >
          All ({skills.length})
        </button>
        <button
          onClick={() => setActiveTab('builtin')}
          className={`rounded-md px-2.5 py-1 text-xs transition-colors cursor-pointer ${
            activeTab === 'builtin' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-accent'
          }`}
        >
          Built-in ({skills.filter((s) => s.source === 'builtin' || !s.source).length})
        </button>
        <button
          onClick={() => setActiveTab('global')}
          className={`rounded-md px-2.5 py-1 text-xs transition-colors cursor-pointer ${
            activeTab === 'global' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-accent'
          }`}
        >
          Global & System ({skills.filter((s) => s.source === 'global').length})
        </button>
        <button
          onClick={() => setActiveTab('custom')}
          className={`rounded-md px-2.5 py-1 text-xs transition-colors cursor-pointer ${
            activeTab === 'custom' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-accent'
          }`}
        >
          Custom ({skills.filter((s) => s.source === 'custom').length})
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {filteredSkills.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
            No skills found in this category.
          </div>
        ) : (
          filteredSkills.map((skill) => (
            <SettingsCard key={skill.id}>
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-2.5">
                  <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10">
                    {getSkillIcon(skill.icon)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground">{skill.name}</span>
                      {skill.slash_command && (
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-primary">
                          /{skill.slash_command}
                        </span>
                      )}
                      <span className="rounded border border-border/60 bg-muted/30 px-1.5 py-0.2 text-[9px] uppercase tracking-wider text-muted-foreground font-medium">
                        {skill.source ?? 'builtin'}
                      </span>
                    </div>
                    <div className="text-muted-foreground text-[11px] mt-0.5">
                      {skill.description}
                    </div>
                    {skill.path && (
                      <div className="font-mono text-[10px] text-muted-foreground/70 truncate max-w-md mt-0.5" title={skill.path}>
                        {skill.path}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Switch
                    checked={skill.enabled}
                    onCheckedChange={(checked) => handleToggle(skill.id, checked)}
                  />
                  <CardActions
                    onEdit={() => openEdit(skill)}
                    onDelete={() => handleDelete(skill.id)}
                    editTitle="Edit skill"
                    deleteTitle="Delete skill"
                  />
                </div>
              </div>

              <PromptPreview>{skill.system_prompt}</PromptPreview>
            </SettingsCard>
          ))
        )}
      </div>

      <PaneDialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editingSkill ? 'Edit Skill' : 'Create Custom Skill'}
        description="Define a reusable prompt persona or specialized workflow."
        onSave={handleSaveSkill}
        saveLabel={editingSkill ? 'Save Changes' : 'Create Skill'}
        saveDisabled={!name.trim() || !systemPrompt.trim()}
      >
        <div className="space-y-1">
          <Label className="text-xs">Skill Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Security Auditor"
            className="h-8 text-xs"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Slash Command Trigger</Label>
          <div className="flex items-center gap-1">
            <span className="text-xs font-mono text-muted-foreground">/</span>
            <Input
              value={slashCommand}
              onChange={(e) => setSlashCommand(e.target.value)}
              placeholder="audit"
              className="h-8 text-xs font-mono"
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Description</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Audit code for security holes, injection risks, and OWASP top 10."
            className="h-8 text-xs"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">System Instructions & Prompt</Label>
          <Textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="You are a principal cybersecurity auditor. Analyze the following code..."
            rows={4}
            className="min-h-0 px-3 py-1.5 text-xs shadow-xs"
          />
        </div>
      </PaneDialog>
    </div>
  )
}
