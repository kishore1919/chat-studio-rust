import { useState } from 'react'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useSettingsStore } from '../store/settings'
import type { PromptTemplate } from '../lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

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
        id: `prompt-${Date.now()}`,
        name: name.trim(),
        content: content.trim(),
      }
      save({ ...settings, prompts: [...prompts, newPrompt] })
    }

    setModalOpen(false)
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Prompts</h2>
          <p className="text-xs text-muted-foreground">
            Saved message snippets, applied via <span className="font-mono">/prompt &lt;name&gt;</span> in
            the composer. Unlike a skill or agent, a prompt is inserted as your draft message text to
            review and send - it doesn't change the conversation's system prompt.
          </p>
        </div>
        <Button size="sm" onClick={openAdd} className="gap-1.5 text-xs">
          <PlusIcon className="size-3.5" /> New Prompt
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {prompts.length === 0 && (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
            No saved prompts yet. Create one to use it with /prompt in any conversation.
          </p>
        )}
        {prompts.map((prompt) => (
          <div
            key={prompt.id}
            className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-xs transition-colors"
          >
            <div className="flex items-start justify-between">
              <span className="font-semibold text-foreground">{prompt.name}</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => openEdit(prompt)}
                  className="size-7 text-muted-foreground hover:text-foreground"
                  title="Edit prompt"
                >
                  <PencilIcon className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => handleDelete(prompt.id)}
                  className="size-7 text-muted-foreground hover:text-destructive"
                  title="Delete prompt"
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            </div>
            <div className="rounded-lg bg-muted/40 p-2 text-[11px] font-mono text-muted-foreground line-clamp-3">
              {prompt.content}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingPrompt ? 'Edit Prompt' : 'New Prompt'}</DialogTitle>
            <DialogDescription>Give it a short name to reference with /prompt &lt;name&gt;.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 pt-1">
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
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Describe the bug: what you expected, what happened, and steps to reproduce."
                rows={5}
                className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!name.trim() || !content.trim()}>
              {editingPrompt ? 'Save Prompt' : 'Create Prompt'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
