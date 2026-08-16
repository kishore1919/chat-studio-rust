import { useState } from 'react'
import {
  BrainIcon,
  CodeIcon,
  FileTextIcon,
  LanguagesIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
} from 'lucide-react'
import { useSettingsStore } from '../store/settings'
import type { Skill } from '../lib/types'
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

function getSkillIcon(icon: string) {
  switch (icon) {
    case 'code':
      return <CodeIcon className="size-4 text-primary" />
    case 'file-text':
      return <FileTextIcon className="size-4 text-primary" />
    case 'brain':
      return <BrainIcon className="size-4 text-primary" />
    case 'languages':
      return <LanguagesIcon className="size-4 text-primary" />
    default:
      return <SparklesIcon className="size-4 text-primary" />
  }
}

export function SkillsPane() {
  const settings = useSettingsStore((s) => s.settings)
  const save = useSettingsStore((s) => s.save)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null)

  const [name, setName] = useState('')
  const [slashCommand, setSlashCommand] = useState('')
  const [description, setDescription] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')

  const skills = settings?.skills ?? []

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
        id: `skill-${Date.now()}`,
        name: name.trim(),
        slash_command: cleanSlash,
        description: description.trim(),
        system_prompt: systemPrompt.trim(),
        icon: 'sparkles',
        enabled: true,
      }
      save({ ...settings, skills: [...skills, newSkill] })
    }

    setModalOpen(false)
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Skills & Persona Prompts</h2>
          <p className="text-xs text-muted-foreground">
            Custom modular abilities, review workflows, and specialized system prompts callable with /slash commands.
          </p>
        </div>
        <Button size="sm" onClick={openAdd} className="gap-1.5 text-xs">
          <PlusIcon className="size-3.5" /> Add Skill
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {skills.map((skill) => (
          <div
            key={skill.id}
            className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-xs transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-2.5">
                <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10">
                  {getSkillIcon(skill.icon)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">{skill.name}</span>
                    {skill.slash_command && (
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-primary">
                        /{skill.slash_command}
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground text-[11px] mt-0.5">
                    {skill.description}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={skill.enabled}
                  onCheckedChange={(checked) => handleToggle(skill.id, checked)}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => openEdit(skill)}
                  className="size-7 text-muted-foreground hover:text-foreground"
                  title="Edit skill"
                >
                  <PencilIcon className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => handleDelete(skill.id)}
                  className="size-7 text-muted-foreground hover:text-destructive"
                  title="Delete skill"
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            </div>

            {/* Prompt preview */}
            <div className="rounded-lg bg-muted/40 p-2 text-[11px] font-mono text-muted-foreground line-clamp-2">
              {skill.system_prompt}
            </div>
          </div>
        ))}
      </div>

      {/* Add / Edit Skill Dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingSkill ? 'Edit Skill' : 'Create Custom Skill'}</DialogTitle>
            <DialogDescription>
              Define a reusable prompt persona or specialized workflow.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 pt-1">
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
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="You are a principal cybersecurity auditor. Analyze the following code..."
                rows={4}
                className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveSkill} disabled={!name.trim() || !systemPrompt.trim()}>
              {editingSkill ? 'Save Changes' : 'Create Skill'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
