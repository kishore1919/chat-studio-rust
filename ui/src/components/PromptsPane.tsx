import { useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { useSettingsStore } from '../store/settings'
import type { PromptTemplate } from '../lib/types'
import { newId } from '../lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PaneHeader } from './settings/PaneHeader'
import { SettingsCard } from './settings/SettingsCard'
import { CardActions } from './settings/CardActions'
import { PromptPreview } from './settings/PromptPreview'
import { PaneDialog } from './settings/PaneDialog'

export function PromptsPane() {
  const settings = useSettingsStore((s) => s.settings)
  const save = useSettingsStore((s) => s.save)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<PromptTemplate | null>(null)

  const [name, setName] = useState('')
  const [content, setContent] = useState('')

  const prompts = settings?.prompts ?? []

  const handleDelete = (id: string) => {
    if (!settings) return
    save({ ...settings, prompts: prompts.filter((p) => p.id !== id) })
  }

  const openAdd = () => {
    setEditingPrompt(null)
    setName('')
    setContent('')
    setModalOpen(true)
  }

  const openEdit = (prompt: PromptTemplate) => {
    setEditingPrompt(prompt)
    setName(prompt.name)
    setContent(prompt.content)
    setModalOpen(true)
  }

  const handleSave = () => {
    if (!settings || !name.trim() || !content.trim()) return

    if (editingPrompt) {
      save({
        ...settings,
        prompts: prompts.map((p) =>
          p.id === editingPrompt.id ? { ...p, name: name.trim(), content: content.trim() } : p,
        ),
      })
    } else {
      const newPrompt: PromptTemplate = {
        id: newId('prompt'),
        name: name.trim(),
        content: content.trim(),
      }
      save({ ...settings, prompts: [...prompts, newPrompt] })
    }

    setModalOpen(false)
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PaneHeader
        title="Prompts"
        description={
          <>
            Saved message snippets, applied via <span className="font-mono">/prompt &lt;name&gt;</span> in
            the composer. Unlike a skill or agent, a prompt is inserted as your draft message text to
            review and send - it doesn't change the conversation's system prompt.
          </>
        }
      >
        <Button size="sm" onClick={openAdd} className="gap-1.5 text-xs">
          <PlusIcon className="size-3.5" /> New Prompt
        </Button>
      </PaneHeader>

      <div className="grid grid-cols-1 gap-3">
        {prompts.length === 0 && (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
            No saved prompts yet. Create one to use it with /prompt in any conversation.
          </p>
        )}
        {prompts.map((prompt) => (
          <SettingsCard key={prompt.id}>
            <div className="flex items-start justify-between">
              <span className="font-semibold text-foreground">{prompt.name}</span>
              <div className="flex items-center gap-2">
                <CardActions
                  onEdit={() => openEdit(prompt)}
                  onDelete={() => handleDelete(prompt.id)}
                  editTitle="Edit prompt"
                  deleteTitle="Delete prompt"
                />
              </div>
            </div>
            <PromptPreview lines={3}>{prompt.content}</PromptPreview>
          </SettingsCard>
        ))}
      </div>

      <PaneDialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editingPrompt ? 'Edit Prompt' : 'New Prompt'}
        description={
          <>Give it a short name to reference with /prompt &lt;name&gt;.</>
        }
        onSave={handleSave}
        saveLabel={editingPrompt ? 'Save Prompt' : 'Create Prompt'}
        saveDisabled={!name.trim() || !content.trim()}
      >
        <div className="space-y-1">
          <Label className="text-xs">Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. bug-report"
            className="h-8 text-xs"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Message text</Label>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Describe the bug: what you expected, what happened, and steps to reproduce."
            rows={5}
            className="min-h-0 px-3 py-1.5 text-xs shadow-xs"
          />
        </div>
      </PaneDialog>
    </div>
  )
}
