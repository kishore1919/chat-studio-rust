import { useState, type KeyboardEvent } from 'react'
import {
  BotIcon,
  BrainIcon,
  CheckIcon,
  CodeIcon,
  EraserIcon,
  GitBranchIcon,
  MenuIcon,
  PencilIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
} from 'lucide-react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import { cn } from '../lib/utils'
import { FEATURES } from '../lib/features'
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
  mindMapOpen?: boolean
  onToggleMindMap?: () => void
}

const CUSTOM_MODEL_VALUE = '__custom__'
const VALUE_SEP = ':::'

function getAgentIcon(icon: string) {
  switch (icon) {
    case 'code':
      return <CodeIcon className="size-3.5 text-primary shrink-0" />
    case 'search':
      return <SearchIcon className="size-3.5 text-primary shrink-0" />
    case 'brain':
      return <BrainIcon className="size-3.5 text-primary shrink-0" />
    case 'sparkles':
      return <SparklesIcon className="size-3.5 text-primary shrink-0" />
    default:
      return <BotIcon className="size-3.5 text-primary shrink-0" />
  }
}

export function ChatHeader({
  onToggleSidebar,
  onOpenSettings,
  mindMapOpen,
  onToggleMindMap,
}: ChatHeaderProps) {
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const conversations = useChatStore((s) => s.conversations)
  const setConversationModel = useChatStore((s) => s.setConversationModel)
  const setConversationSystemPrompt = useChatStore((s) => s.setConversationSystemPrompt)
  const renameConversation = useChatStore((s) => s.renameConversation)
  const clearConversation = useChatStore((s) => s.clearConversation)
  const activeAgentId = useChatStore((s) => s.activeAgentId)
  const setActiveAgentId = useChatStore((s) => s.setActiveAgentId)
  const settings = useSettingsStore((s) => s.settings)
  const modelsByProvider = useSettingsStore((s) => s.modelsByProvider)
  const refreshModels = useSettingsStore((s) => s.refreshModels)
  const active = conversations.find((c) => c.id === activeConversationId)

  const [draftProvider, setDraftProvider] = useState('')
  const [draftModel, setDraftModel] = useState('')

  const [editingTitle, setEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')

  const [confirmClear, setConfirmClear] = useState(false)
  const [customModelOpen, setCustomModelOpen] = useState(false)

  const agents = settings?.agents?.filter((a) => a.enabled) ?? []
  const currentAgent = agents.find((a) => a.id === activeAgentId) ?? agents[0]

  const handleAgentSelect = (agentId: string) => {
    if (agentId === '__manage__') {
      onOpenSettings()
      return
    }
    setActiveAgentId(agentId)
    const agent = agents.find((a) => a.id === agentId)
    if (agent && active) {
      // This is what makes picking an agent actually do something - it used
      // to only swap provider/model (and only for the few agents that
      // specify one), never applying the agent's own system prompt.
      setConversationSystemPrompt(active.id, agent.system_prompt)
      if (agent.provider && agent.model) {
        setConversationModel(active.id, agent.provider, agent.model)
      }
    }
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


  const suggestions = modelsByProvider[draftProvider] ?? []
  const enabledProviders = settings?.providers.filter((p) => p.enabled) ?? []
  const activeProvider = settings?.providers.find((p) => p.id === active?.provider)

  const handleSelect = (value: string) => {
    if (!active) return
    if (value === CUSTOM_MODEL_VALUE) {
      setDraftProvider(active.provider)
      setDraftModel(active.model)
      setCustomModelOpen(true)
      return
    }
    const [providerId, modelId] = value.split(VALUE_SEP)
    setConversationModel(active.id, providerId, modelId)
  }

  const commitCustomModel = () => {
    if (active && draftModel.trim()) {
      setConversationModel(active.id, draftProvider, draftModel.trim())
    }
    setCustomModelOpen(false)
  }

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/40 px-3 select-none">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          className="size-8 text-muted-foreground hover:text-foreground"
          title="Toggle sidebar"
        >
          <MenuIcon className="size-4" />
        </Button>

        <div className="flex items-center gap-1.5 text-[13px] min-w-0">
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
              className="group flex max-w-44 items-center gap-1 text-left font-semibold text-foreground hover:text-primary transition-colors cursor-pointer"
              title="Click to rename chat heading"
            >
              <span className="truncate">{active?.title || 'Chat Studio'}</span>
              {active && (
                <PencilIcon className="size-3 opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
              )}
            </button>
          )}

          {/* Assistant Selector - hidden while inert, see lib/features.ts */}
          {FEATURES.agents && (
            <>
              <span className="mx-0.5 h-4 w-px bg-border/60" aria-hidden="true" />
              <div className="flex items-center">
                <Select
                  value={currentAgent?.id ?? 'general-assistant'}
                  onValueChange={handleAgentSelect}
                >
                  <SelectTrigger
                    size="sm"
                    className="h-7 max-w-44 border-0 bg-accent/40 px-2 shadow-none hover:bg-accent text-xs font-medium rounded-md"
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      {getAgentIcon(currentAgent?.icon ?? 'bot')}
                      <span className="truncate">{currentAgent?.name ?? 'Assistant'}</span>
                    </span>
                  </SelectTrigger>
                  <SelectContent className="max-h-80 max-w-64">
                    <SelectGroup>
                      <SelectLabel className="font-semibold text-xs">Assistants & Agents</SelectLabel>
                      {agents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          <div className="flex items-center gap-2">
                            {getAgentIcon(agent.icon)}
                            <div className="flex flex-col text-left">
                              <span className="font-medium text-xs">{agent.name}</span>
                              <span className="text-[10px] text-muted-foreground">{agent.role}</span>
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    <SelectSeparator />
                    <SelectItem value="__manage__" className="text-xs text-primary font-medium">
                      + Manage Assistants in Settings...
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {active && (
            <div className="flex items-center">
              {!FEATURES.agents && <span className="mx-0.5 h-4 w-px bg-border/60" aria-hidden="true" />}
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
                  className="h-7 max-w-56 border-0 bg-transparent px-1.5 shadow-none hover:bg-accent/50 text-xs"
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

          <Dialog open={customModelOpen} onOpenChange={setCustomModelOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Custom model</DialogTitle>
                <DialogDescription>Enter the model ID to use for this conversation.</DialogDescription>
              </DialogHeader>
              <Input
                autoFocus
                value={draftModel}
                onChange={(e) => setDraftModel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitCustomModel()
                  else if (e.key === 'Escape') setCustomModelOpen(false)
                }}
                list="model-suggestions-custom"
                placeholder="e.g. gpt-4o, claude-3-5-sonnet"
                className="h-8 font-mono text-xs"
              />
              <datalist id="model-suggestions-custom">
                {suggestions.map((m) => (
                  <option key={m.id} value={m.id} />
                ))}
              </datalist>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCustomModelOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={commitCustomModel} disabled={!draftModel.trim()}>
                  Use model
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {active && onToggleMindMap && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleMindMap}
            aria-label={mindMapOpen ? 'Hide mind map' : 'Show mind map'}
            className={cn(
              'size-8 transition-colors',
              mindMapOpen
                ? 'bg-accent text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title="Toggle Mind Map (Input Flow)"
          >
            <GitBranchIcon className="size-4" />
          </Button>
        )}
        {active && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setConfirmClear(true)}
            aria-label="Clear conversation"
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
          aria-label="Open settings"
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
