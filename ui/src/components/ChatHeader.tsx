import { useState, type KeyboardEvent } from 'react'
import { CheckIcon, EraserIcon, MenuIcon, PencilIcon, SettingsIcon, SparklesIcon } from 'lucide-react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ChatHeaderProps {
  onToggleSidebar: () => void
  onOpenSettings: () => void
}

const CUSTOM_MODEL_VALUE = '__custom__'
const VALUE_SEP = ':::'

export function ChatHeader({ onToggleSidebar, onOpenSettings }: ChatHeaderProps) {
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const conversations = useChatStore((s) => s.conversations)
  const setConversationModel = useChatStore((s) => s.setConversationModel)
  const renameConversation = useChatStore((s) => s.renameConversation)
  const clearConversation = useChatStore((s) => s.clearConversation)
  const settings = useSettingsStore((s) => s.settings)
  const modelsByProvider = useSettingsStore((s) => s.modelsByProvider)
  const refreshModels = useSettingsStore((s) => s.refreshModels)
  const active = conversations.find((c) => c.id === activeConversationId)

  const [editingModel, setEditingModel] = useState(false)
  const [draftProvider, setDraftProvider] = useState('')
  const [draftModel, setDraftModel] = useState('')

  const [editingTitle, setEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')

  const [confirmClear, setConfirmClear] = useState(false)

  const startEditingModel = () => {
    if (!active) return
    setDraftProvider(active.provider)
    setDraftModel(active.model)
    setEditingModel(true)
  }

  const commitModel = () => {
    if (active && draftModel.trim()) {
      setConversationModel(active.id, draftProvider, draftModel.trim())
    }
    setEditingModel(false)
  }

  const startEditingTitle = () => {
    if (!active) return
    setDraftTitle(active.title)
    setEditingTitle(true)
  }

  const commitTitle = () => {
    if (active && draftTitle.trim() && draftTitle.trim() !== active.title) {
      renameConversation(active.id, draftTitle.trim())
    }
    setEditingTitle(false)
  }

  const handleTitleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitTitle()
    else if (e.key === 'Escape') setEditingTitle(false)
  }

  const handleModelKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitModel()
    else if (e.key === 'Escape') setEditingModel(false)
  }

  const suggestions = modelsByProvider[draftProvider] ?? []
  const enabledProviders = settings?.providers.filter((p) => p.enabled) ?? []
  const activeProvider = settings?.providers.find((p) => p.id === active?.provider)

  const handleSelect = (value: string) => {
    if (!active) return
    if (value === CUSTOM_MODEL_VALUE) {
      startEditingModel()
      return
    }
    const [providerId, modelId] = value.split(VALUE_SEP)
    setConversationModel(active.id, providerId, modelId)
  }

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3 select-none">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleSidebar}
          className="size-8 text-muted-foreground hover:text-foreground"
          title="Toggle sidebar"
        >
          <MenuIcon className="size-4" />
        </Button>

        <div className="flex items-center gap-2 text-[13px] min-w-0">
          {/* Editable Chat Heading */}
          {active && editingTitle ? (
            <div className="flex items-center gap-1">
              <Input
                autoFocus
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onKeyDown={handleTitleKeyDown}
                onBlur={commitTitle}
                className="h-7 w-48 text-xs font-semibold"
              />
              <Button variant="ghost" size="icon-sm" onClick={commitTitle} className="size-6">
                <CheckIcon className="size-3 text-success" />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={startEditingTitle}
              className="group flex max-w-56 items-center gap-1 text-left font-semibold text-foreground hover:text-primary transition-colors cursor-pointer"
              title="Click to rename chat heading"
            >
              <span className="truncate">{active?.title || 'Chat Studio'}</span>
              {active && (
                <PencilIcon className="size-3 opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
              )}
            </button>
          )}

          {active && !editingModel && (
            <div className="flex items-center">
              <span className="mx-1 text-muted-foreground/60">·</span>
              <Select
                value={`${active.provider}${VALUE_SEP}${active.model}`}
                onValueChange={handleSelect}
                onOpenChange={(open) => {
                  if (!open) return
                  for (const p of enabledProviders) {
                    if (!modelsByProvider[p.id]) refreshModels(p.id, false)
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="h-7 max-w-64 border-0 bg-transparent px-1.5 shadow-none hover:bg-accent/50 text-xs"
                >
                  <span className="flex items-center gap-1 truncate">
                    <SparklesIcon className="size-3 text-primary shrink-0" />
                    <span>
                      {activeProvider?.display_name ?? active.provider}
                      {' · '}
                      <span className="text-muted-foreground">{active.model || 'select model...'}</span>
                    </span>
                  </span>
                </SelectTrigger>
                <SelectContent className="max-h-80 max-w-80">
                  {enabledProviders.map((p) => {
                    const addedModels = p.models ?? []
                    const hasCurrent =
                      p.id === active.provider && addedModels.includes(active.model)
                    return (
                      <SelectGroup key={p.id}>
                        <SelectLabel className="font-semibold text-xs">{p.display_name}</SelectLabel>
                        {p.id === active.provider && active.model && !hasCurrent && (
                          <SelectItem value={`${p.id}${VALUE_SEP}${active.model}`}>
                            {active.model}
                          </SelectItem>
                        )}
                        {addedModels.length === 0 ? (
                          <div className="px-2 py-1.5 text-[11px] text-muted-foreground italic">
                            No models added yet (add in Settings)
                          </div>
                        ) : (
                          addedModels.map((modelId) => (
                            <SelectItem key={modelId} value={`${p.id}${VALUE_SEP}${modelId}`}>
                              {modelId}
                            </SelectItem>
                          ))
                        )}
                      </SelectGroup>
                    )
                  })}
                  <SelectSeparator />
                  <SelectItem value={CUSTOM_MODEL_VALUE}>Custom model...</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {active && editingModel && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground/60">·</span>
              <Input
                autoFocus
                value={draftModel}
                onChange={(e) => setDraftModel(e.target.value)}
                onKeyDown={handleModelKeyDown}
                onBlur={commitModel}
                list="model-suggestions"
                placeholder="Type a model id..."
                className="h-7 w-48 border-ring text-xs font-mono"
              />
              <datalist id="model-suggestions">
                {suggestions.map((m) => (
                  <option key={m.id} value={m.id} />
                ))}
              </datalist>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1">
        {active && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setConfirmClear(true)}
            className="size-8 text-muted-foreground hover:text-foreground"
            title="Clear context"
          >
            <EraserIcon className="size-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onOpenSettings}
          className="size-8 text-muted-foreground hover:text-foreground"
          title="Settings (Ctrl+,)"
        >
          <SettingsIcon className="size-4" />
        </Button>
      </div>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear context?</DialogTitle>
            <DialogDescription>
              This deletes every message in this conversation. The conversation itself stays, so you
              can keep chatting from a clean slate.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (active) clearConversation(active.id)
                setConfirmClear(false)
              }}
            >
              Clear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  )
}
