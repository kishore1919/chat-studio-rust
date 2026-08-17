import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckSquareIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import type { Conversation } from '../lib/types'
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
import { cn } from '@/lib/utils'

interface SidebarProps {
  collapsed: boolean
  /** Pins the sidebar open (vs. hover's temporary preview). */
  onExpand: () => void
}

function relativeTime(unixSeconds: number) {
  const diffMs = Date.now() - unixSeconds * 1000
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

type Group = 'Pinned' | 'Today' | 'Yesterday' | 'Previous 7 Days' | 'Older'

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Buckets an already-sorted (pinned-first, then newest-first) conversation
 * list into Cherry-Studio-style time groups. Pinned items always form their
 * own leading group regardless of when they were last touched. */
function groupConversations(conversations: Conversation[]): [Group, Conversation[]][] {
  const todayStart = startOfDay(new Date())
  const yesterdayStart = todayStart - 86_400_000
  const sevenDaysAgoStart = todayStart - 7 * 86_400_000

  const buckets = new Map<Group, Conversation[]>()
  for (const conv of conversations) {
    let group: Group
    if (conv.pinned) {
      group = 'Pinned'
    } else {
      const updatedAtMs = conv.updated_at * 1000
      if (updatedAtMs >= todayStart) group = 'Today'
      else if (updatedAtMs >= yesterdayStart) group = 'Yesterday'
      else if (updatedAtMs >= sevenDaysAgoStart) group = 'Previous 7 Days'
      else group = 'Older'
    }
    if (!buckets.has(group)) buckets.set(group, [])
    buckets.get(group)!.push(conv)
  }

  const order: Group[] = ['Pinned', 'Today', 'Yesterday', 'Previous 7 Days', 'Older']
  return order.filter((g) => buckets.has(g)).map((g) => [g, buckets.get(g)!])
}

interface ConversationRowProps {
  conv: Conversation
  active: boolean
  isSelectMode: boolean
  isSelected: boolean
  onToggleSelect: () => void
  onSelect: () => void
  onRename: () => void
  onTogglePin: () => void
  onDelete: () => void
}

/** A correct `role="listbox"`/`role="option"` pattern needs roving
 * `tabIndex`, `aria-activedescendant`, and full arrow/Home/End/type-ahead
 * handling - and it's the wrong pattern regardless, since each row nests its
 * own buttons (delete, the "more" menu), which is invalid inside an
 * `option`. This uses the standard overlay-button pattern instead: a
 * full-bleed button under everything provides native focus/Enter/Space/tab
 * order, and the visible content sits above it with pointer-events
 * re-enabled only on the bits that need their own clicks. */
function ConversationRow({
  conv,
  active,
  isSelectMode,
  isSelected,
  onToggleSelect,
  onSelect,
  onRename,
  onTogglePin,
  onDelete,
}: ConversationRowProps) {
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={isSelectMode ? onToggleSelect : onSelect}
        aria-label={`Open ${conv.title}`}
        aria-current={active ? 'true' : undefined}
        className="absolute inset-0 z-0 rounded-lg"
      />
      <div
        className={cn(
          'pointer-events-none relative z-10 flex items-start justify-between rounded-lg border px-2.5 py-2 text-[13px] transition-colors',
          isSelected
            ? 'border-primary/20 bg-primary/10 font-medium text-foreground'
            : active
              ? 'border-border/40 bg-accent font-medium text-foreground shadow-xs'
              : 'border-transparent text-muted-foreground group-hover:border-border/30 group-hover:bg-accent/50 group-hover:text-foreground',
        )}
      >
        <div className="flex min-w-0 flex-1 items-start gap-2">
          {isSelectMode && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              className="pointer-events-auto mt-0.5 size-3.5 rounded border-border accent-primary cursor-pointer shrink-0"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-foreground leading-snug">{conv.title}</div>
            {conv.model && (
              <div className="truncate text-[11px] text-muted-foreground font-mono">
                {conv.model}
              </div>
            )}
          </div>
        </div>

        {!isSelectMode && (
          <div className="pointer-events-auto flex shrink-0 items-center gap-1 pl-1">
            {conv.pinned && (
              <PinIcon className="size-3 text-primary opacity-80 group-hover:hidden" />
            )}
            <span className="text-[11px] text-muted-foreground group-hover:hidden">
              {!conv.pinned && relativeTime(conv.updated_at)}
            </span>
            <div className="hidden items-center gap-0.5 group-hover:flex">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onDelete}
                className="size-6 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title="Delete conversation"
              >
                <Trash2Icon className="size-3.5" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-6 text-muted-foreground hover:text-foreground"
                    title="More actions"
                  >
                    <MoreHorizontalIcon className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={onTogglePin}>
                    {conv.pinned ? (
                      <>
                        <PinOffIcon className="size-3.5 mr-1.5" /> Unpin
                      </>
                    ) : (
                      <>
                        <PinIcon className="size-3.5 mr-1.5" /> Pin
                      </>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onRename}>
                    <PencilIcon className="size-3.5 mr-1.5" /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={onDelete}>
                    <Trash2Icon className="size-3.5 mr-1.5" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )}
      </div>
    </li>
  )
}

export function Sidebar({ collapsed, onExpand }: SidebarProps) {
  const conversations = useChatStore((s) => s.conversations)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const selectConversation = useChatStore((s) => s.selectConversation)
  const createConversation = useChatStore((s) => s.createConversation)
  const renameConversation = useChatStore((s) => s.renameConversation)
  const pinConversation = useChatStore((s) => s.pinConversation)
  const deleteConversation = useChatStore((s) => s.deleteConversation)
  const deleteConversations = useChatStore((s) => s.deleteConversations)
  const loadConversations = useChatStore((s) => s.loadConversations)
  const settings = useSettingsStore((s) => s.settings)
  const autoCreatedRef = useRef(false)

  const [search, setSearch] = useState('')
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false)
  const [renameTarget, setRenameTarget] = useState<{ id: number; title: string } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

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
    const providerId = settings.default_provider ?? settings.providers[0]?.id
    if (!providerId) return
    autoCreatedRef.current = true
    createConversation(providerId, settings.default_model ?? '')
  }, [settings, conversations, createConversation])

  const handleNewChat = () => {
    if (!settings) return
    const providerId = settings.default_provider ?? settings.providers[0]?.id
    if (!providerId) return
    createConversation(providerId, settings.default_model ?? '')
  }

  const filtered = useMemo(
    () => conversations.filter((c) => c.title.toLowerCase().includes(search.toLowerCase())),
    [conversations, search],
  )
  const grouped = useMemo(() => groupConversations(filtered), [filtered])

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

      {/* Main Sidebar - opens only via explicit click/Ctrl+B, not on hover. */}
      <aside
        id="conversation-sidebar"
        className={cn(
          'flex flex-col border-r border-border/40 bg-sidebar select-none transition-all duration-200 ease-[cubic-bezier(.16,1,.3,1)]',
          collapsed
            ? 'fixed top-0 bottom-0 left-0 z-40 w-[272px] shadow-2xl -translate-x-full opacity-0 pointer-events-none'
            : 'relative w-[272px] shrink-0',
        )}
      >
        {/* Top Search & Multi-Select Bar */}
        <div className="p-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <SearchIcon className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search chats..."
                aria-label="Search chats"
                className="h-8 pl-7 pr-7 text-xs"
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

            <Button
              variant={isSelectMode ? 'default' : 'outline'}
              size="icon-sm"
              onClick={() => {
                setIsSelectMode((v) => !v)
                setSelectedIds(new Set())
              }}
              className="size-8 shrink-0"
              title={isSelectMode ? 'Exit select mode' : 'Select multiple chats to delete'}
            >
              <CheckSquareIcon className="size-3.5" />
            </Button>
          </div>

          {/* Multi-Select Action Bar */}
          {isSelectMode && (
            <div className="flex items-center justify-between rounded-lg bg-accent/40 px-2 py-1 text-xs">
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

        <div aria-label="Conversations" className="flex-1 overflow-y-auto px-2">
          {grouped.map(([group, items]) => (
            <div key={group} className="mb-2">
              <div className="px-3 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                {group}
              </div>
              <ul>
                {items.map((conv) => (
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
            <div className="px-3 py-4 text-center">
              <p className="text-[13px] text-muted-foreground">No chats found.</p>
              <Button onClick={handleNewChat} variant="ghost" size="sm" className="mt-2 h-7 gap-1 text-xs">
                <PlusIcon className="size-3.5" /> New chat
              </Button>
            </div>
          )}
        </div>

        <Button onClick={handleNewChat} variant="outline" className="m-3 h-8 gap-1.5">
          <PlusIcon className="size-4" /> New chat
        </Button>

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
