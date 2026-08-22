import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BotIcon,
  BrainIcon,
  CheckSquareIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CodeIcon,
  MessageSquarePlusIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
  ZapIcon,
  type LucideIcon,
} from 'lucide-react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import type { AgentConfig, Conversation } from '../lib/types'
import { newId } from '../lib/utils'
import { ConversationRow } from './ConversationRow'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface SidebarProps {
  collapsed: boolean
  /** Pins the sidebar open (vs. hover's temporary preview). */
  onExpand: () => void
  onOpenSettings?: () => void
}

const AGENT_ICONS: Record<string, LucideIcon> = {
  code: CodeIcon,
  search: SearchIcon,
  brain: BrainIcon,
  zap: ZapIcon,
  sparkles: ZapIcon,
}

function getAgentIcon(icon: string) {
  const Icon = AGENT_ICONS[icon] ?? BotIcon
  return <Icon className="size-4 text-primary shrink-0" />
}

export function Sidebar({ collapsed, onExpand, onOpenSettings }: SidebarProps) {
  const conversations = useChatStore((s) => s.conversations)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const activeAgentId = useChatStore((s) => s.activeAgentId)
  const setActiveAgentId = useChatStore((s) => s.setActiveAgentId)
  const selectConversation = useChatStore((s) => s.selectConversation)
  const createConversation = useChatStore((s) => s.createConversation)
  const renameConversation = useChatStore((s) => s.renameConversation)
  const pinConversation = useChatStore((s) => s.pinConversation)
  const deleteConversation = useChatStore((s) => s.deleteConversation)
  const deleteConversations = useChatStore((s) => s.deleteConversations)
  const loadConversations = useChatStore((s) => s.loadConversations)
  const settings = useSettingsStore((s) => s.settings)
  const saveSettings = useSettingsStore((s) => s.save)
  const autoCreatedRef = useRef(false)

  const [search, setSearch] = useState('')
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false)
  const [renameTarget, setRenameTarget] = useState<{ id: number; title: string } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [addAssistantOpen, setAddAssistantOpen] = useState(false)
  const [newAssistantName, setNewAssistantName] = useState('')
  const [newAssistantRole, setNewAssistantRole] = useState('')
  const [newAssistantPrompt, setNewAssistantPrompt] = useState('')

  const agents: AgentConfig[] = useMemo(() => {
    return settings?.agents?.filter((a) => a.enabled) ?? [
      {
        id: 'general-assistant',
        name: 'Default Assistant',
        description: 'Helpful AI Assistant',
        role: 'Assistant',
        system_prompt: '',
        provider: null,
        model: null,
        skills: [],
        icon: 'bot',
        enabled: true,
      },
    ]
  }, [settings?.agents])

  const currentAgent = agents.find((a) => a.id === activeAgentId) ?? agents[0]

  useEffect(() => {
    loadConversations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (autoCreatedRef.current || !settings) return
    if (conversations.length > 0) {
      autoCreatedRef.current = true
      return
    }
    const providerId = currentAgent?.provider || settings.default_provider || settings.providers[0]?.id
    if (!providerId) return
    autoCreatedRef.current = true
    createConversation(
      providerId,
      currentAgent?.model || settings.default_model || '',
      currentAgent?.system_prompt || null,
      currentAgent?.id || 'general-assistant',
    )
  }, [settings, conversations, createConversation, currentAgent])

  const handleNewChat = () => {
    if (!settings) return
    const providerId = currentAgent?.provider || settings.default_provider || settings.providers[0]?.id
    if (!providerId) return
    const model = currentAgent?.model || settings.default_model || ''
    createConversation(
      providerId,
      model,
      currentAgent?.system_prompt || null,
      currentAgent?.id || 'general-assistant',
    )
  }

  const handleSwitchAssistant = (agentId: string) => {
    setActiveAgentId(agentId)
    // Find latest chat for this assistant or prompt a fresh one
    const matchingConv = conversations.find(
      (c) => (c.agent_id || 'general-assistant') === agentId,
    )
    if (matchingConv) {
      selectConversation(matchingConv.id)
    } else if (settings) {
      const agent = agents.find((a) => a.id === agentId)
      const providerId = agent?.provider || settings.default_provider || settings.providers[0]?.id
      if (providerId) {
        createConversation(
          providerId,
          agent?.model || settings.default_model || '',
          agent?.system_prompt || null,
          agentId,
        )
      }
    }
  }

  const handleCreateAssistant = async () => {
    if (!settings || !newAssistantName.trim()) return
    const newAgent: AgentConfig = {
      id: newId('assistant'),
      name: newAssistantName.trim(),
      role: newAssistantRole.trim() || 'AI Assistant',
      description: newAssistantRole.trim() || 'Custom Assistant',
      system_prompt: newAssistantPrompt.trim(),
      provider: null,
      model: null,
      skills: [],
      icon: 'bot',
      enabled: true,
    }
    const updated = {
      ...settings,
      agents: [...(settings.agents ?? []), newAgent],
    }
    await saveSettings(updated)
    setNewAssistantName('')
    setNewAssistantRole('')
    setNewAssistantPrompt('')
    setAddAssistantOpen(false)
    handleSwitchAssistant(newAgent.id)
  }

  const currentAgentId = currentAgent?.id || 'general-assistant'

  const filtered = useMemo(
    () =>
      conversations
        .filter((c) => (c.agent_id || 'general-assistant') === currentAgentId)
        .filter((c) => c.title.toLowerCase().includes(search.toLowerCase())),
    [conversations, currentAgentId, search],
  )

  const groupedConversations = useMemo(() => {
    const groups = [
      { label: 'Pinned', items: [] as Conversation[] },
      { label: 'Today', items: [] as Conversation[] },
      { label: 'Yesterday', items: [] as Conversation[] },
      { label: 'Previous 7 Days', items: [] as Conversation[] },
      { label: 'Previous 30 Days', items: [] as Conversation[] },
      { label: 'Older', items: [] as Conversation[] },
    ]

    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const startOfToday = Math.floor(now.getTime() / 1000)
    const startOfYesterday = startOfToday - 86400
    const startOf7DaysAgo = startOfToday - 7 * 86400
    const startOf30DaysAgo = startOfToday - 30 * 86400

    for (const conv of filtered) {
      if (conv.pinned) {
        groups[0].items.push(conv)
      } else if (conv.updated_at >= startOfToday) {
        groups[1].items.push(conv)
      } else if (conv.updated_at >= startOfYesterday) {
        groups[2].items.push(conv)
      } else if (conv.updated_at >= startOf7DaysAgo) {
        groups[3].items.push(conv)
      } else if (conv.updated_at >= startOf30DaysAgo) {
        groups[4].items.push(conv)
      } else {
        groups[5].items.push(conv)
      }
    }

    return groups.filter((g) => g.items.length > 0)
  }, [filtered])

  const toggleSelectConversation = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map((c) => c.id)))
    }
  }

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    await deleteConversations(Array.from(selectedIds))
    setSelectedIds(new Set())
    setIsSelectMode(false)
    setConfirmBatchDelete(false)
  }

  const openRename = (id: number, title: string) => {
    setRenameTarget({ id, title })
    setRenameDraft(title)
  }

  const commitRename = () => {
    if (renameTarget && renameDraft.trim()) {
      renameConversation(renameTarget.id, renameDraft.trim())
    }
    setRenameTarget(null)
  }

  return (
    <>
      {collapsed && (
        <button
          type="button"
          onClick={onExpand}
          className="group fixed top-0 bottom-0 left-0 z-30 w-12 cursor-pointer"
          title="Show sidebar"
          aria-label="Show sidebar"
          aria-expanded={false}
          aria-controls="conversation-sidebar"
        >
          <div className="flex h-full w-1 items-center justify-center bg-border/20 transition-colors group-hover:bg-primary/60">
            <ChevronRightIcon className="-ml-0.5 size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
        </button>
      )}

      <aside
        id="conversation-sidebar"
        className={cn(
          'flex flex-col border-r border-border/40 bg-sidebar select-none transition-all duration-200 ease-[cubic-bezier(.16,1,.3,1)]',
          collapsed
            ? 'fixed top-0 bottom-0 left-0 z-40 w-[272px] shadow-2xl -translate-x-full opacity-0 pointer-events-none'
            : 'relative w-[272px] shrink-0',
        )}
      >
        {/* Top Add Assistant & Filter Bar */}
        <div className="p-3 pb-2 space-y-2 border-b border-border/20">
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddAssistantOpen(true)}
              className="flex-1 h-8 justify-start gap-1.5 text-xs font-medium text-foreground bg-accent/30 hover:bg-accent border-border/40"
            >
              <PlusIcon className="size-3.5" />
              <span>Add Assistant</span>
            </Button>

            <Button
              variant={isSelectMode ? 'default' : 'ghost'}
              size="icon-sm"
              onClick={() => {
                setIsSelectMode((v) => !v)
                setSelectedIds(new Set())
              }}
              className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
              title={isSelectMode ? 'Exit select mode' : 'Select multiple chats'}
            >
              <CheckSquareIcon className="size-3.5" />
            </Button>
          </div>

          {/* Active Assistant Accordion/Dropdown Header */}
          <div className="flex items-center justify-between px-1 py-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 text-xs font-semibold text-foreground hover:text-primary transition-colors cursor-pointer group truncate max-w-[190px]"
                >
                  <div className="size-5 rounded-md bg-primary/20 flex items-center justify-center shrink-0">
                    {getAgentIcon(currentAgent?.icon ?? 'bot')}
                  </div>
                  <span className="truncate">{currentAgent?.name ?? 'Default Assistant'}</span>
                  <ChevronDownIcon className="size-3 text-muted-foreground group-hover:text-foreground transition-transform" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {agents.map((agent) => (
                  <DropdownMenuItem
                    key={agent.id}
                    onClick={() => handleSwitchAssistant(agent.id)}
                    className="flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-2 truncate">
                      {getAgentIcon(agent.icon)}
                      <span className="truncate text-xs font-medium">{agent.name}</span>
                    </div>
                    {agent.id === currentAgent?.id && (
                      <span className="size-1.5 rounded-full bg-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
                {onOpenSettings && (
                  <>
                    <DropdownMenuItem
                      onClick={onOpenSettings}
                      className="text-xs text-primary font-medium cursor-pointer"
                    >
                      Manage Assistants...
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleNewChat}
                className="size-6 text-muted-foreground hover:text-foreground"
                title="New topic in this assistant"
              >
                <MessageSquarePlusIcon className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>

        {/* Search & Select Bar */}
        <div className="px-3 pt-2">
          <div className="relative">
            <SearchIcon className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search topics..."
              aria-label="Search topics"
              className="h-7 pl-7 pr-7 text-xs bg-accent/20 border-border/40"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </div>

          {/* Multi-Select Action Bar */}
          {isSelectMode && (
            <div className="mt-2 flex items-center justify-between rounded-lg bg-accent/40 px-2 py-1 text-xs">
              <span className="text-[11px] font-medium text-foreground">
                {selectedIds.size} selected
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer px-1 py-0.5 rounded"
                >
                  {selectedIds.size === filtered.length && filtered.length > 0 ? 'Deselect All' : 'Select All'}
                </button>
                {selectedIds.size > 0 && (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-6 px-2 text-[11px] gap-1"
                    onClick={() => setConfirmBatchDelete(true)}
                  >
                    <Trash2Icon className="size-3" />
                    <span>Delete</span>
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Conversations / Topics under this Assistant */}
        <div aria-label="Conversations" className="flex-1 overflow-y-auto px-2 py-2">
          {groupedConversations.map((group) => (
            <div key={group.label} className="pb-2 last:pb-0">
              <div className="sticky top-0 z-20 bg-sidebar px-3 pt-3 pb-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                {group.label === 'Pinned' ? (
                  <span className="flex items-center gap-1.5">
                    <PinIcon className="size-3" /> Pinned
                  </span>
                ) : (
                  group.label
                )}
              </div>
              <ul className="space-y-0.5">
                {group.items.map((conv) => (
                  <ConversationRow
                    key={conv.id}
                    conv={conv}
                    active={conv.id === activeConversationId}
                    isSelectMode={isSelectMode}
                    isSelected={selectedIds.has(conv.id)}
                    onToggleSelect={() => toggleSelectConversation(conv.id)}
                    onSelect={() => selectConversation(conv.id)}
                    onRename={() => openRename(conv.id, conv.title)}
                    onTogglePin={() => pinConversation(conv.id, !conv.pinned)}
                    onDelete={() => deleteConversation(conv.id)}
                  />
                ))}
              </ul>
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center">
              <p className="text-[12px] text-muted-foreground">No chats in this assistant.</p>
              <Button onClick={handleNewChat} variant="ghost" size="sm" className="mt-2 h-7 gap-1 text-xs">
                <PlusIcon className="size-3.5" /> Start new chat
              </Button>
            </div>
          )}
        </div>

        {/* Bottom Actions */}
        <div className="p-2 border-t border-border/20">
          <Button onClick={handleNewChat} variant="outline" className="w-full h-8 gap-1.5 text-xs">
            <PlusIcon className="size-3.5" /> New topic
          </Button>
        </div>

        {/* Add Assistant Modal */}
        <Dialog open={addAssistantOpen} onOpenChange={setAddAssistantOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Assistant</DialogTitle>
              <DialogDescription>
                Create a customized assistant persona with its own instructions and personality.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="assistant-name" className="text-xs">Name</Label>
                <Input
                  id="assistant-name"
                  placeholder="e.g. Code Reviewer, Writing Partner"
                  value={newAssistantName}
                  onChange={(e) => setNewAssistantName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="assistant-role" className="text-xs">Role / Description</Label>
                <Input
                  id="assistant-role"
                  placeholder="e.g. Senior Rust Engineer"
                  value={newAssistantRole}
                  onChange={(e) => setNewAssistantRole(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="assistant-prompt" className="text-xs">System Instructions</Label>
                <Textarea
                  id="assistant-prompt"
                  rows={3}
                  placeholder="You are a helpful assistant specialized in..."
                  value={newAssistantPrompt}
                  onChange={(e) => setNewAssistantPrompt(e.target.value)}
                  className="min-h-0 text-xs"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddAssistantOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateAssistant} disabled={!newAssistantName.trim()}>
                Create Assistant
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Batch Delete Confirmation Modal */}
        <Dialog open={confirmBatchDelete} onOpenChange={setConfirmBatchDelete}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {selectedIds.size} conversations?</DialogTitle>
              <DialogDescription>
                This will permanently delete {selectedIds.size} selected conversation{selectedIds.size > 1 ? 's' : ''} and their messages. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmBatchDelete(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleBatchDelete}>
                Delete {selectedIds.size} chat{selectedIds.size > 1 ? 's' : ''}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Rename Modal */}
        <Dialog open={renameTarget !== null} onOpenChange={(open) => !open && setRenameTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename conversation</DialogTitle>
            </DialogHeader>
            <Input
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commitRename()}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setRenameTarget(null)}>
                Cancel
              </Button>
              <Button onClick={commitRename}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </aside>
    </>
  )
}
