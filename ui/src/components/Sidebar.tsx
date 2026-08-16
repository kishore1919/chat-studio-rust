import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '../store/chat'
import { useSettingsStore } from '../store/settings'

interface SidebarProps {
  collapsed: boolean
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

export function Sidebar({ collapsed }: SidebarProps) {
  const conversations = useChatStore((s) => s.conversations)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const selectConversation = useChatStore((s) => s.selectConversation)
  const createConversation = useChatStore((s) => s.createConversation)
  const renameConversation = useChatStore((s) => s.renameConversation)
  const deleteConversation = useChatStore((s) => s.deleteConversation)
  const loadConversations = useChatStore((s) => s.loadConversations)
  const settings = useSettingsStore((s) => s.settings)
  const [menuOpenFor, setMenuOpenFor] = useState<number | null>(null)
  const autoCreatedRef = useRef(false)

  useEffect(() => {
    loadConversations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A fresh install has zero conversations, which left the composer
  // disabled with no obvious explanation ("can't type"). Auto-create one
  // as soon as settings + the (empty) conversation list are both in, so
  // there's always something to type into.
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
    const providerId = settings?.default_provider ?? settings?.providers[0]?.id
    const model = settings?.default_model ?? ''
    if (!providerId) return
    createConversation(providerId, model)
  }

  if (collapsed) return null

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-sidebar)]">
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {conversations.map((conv) => (
          <div
            key={conv.id}
            onClick={() => selectConversation(conv.id)}
            className={`group relative flex cursor-pointer items-start justify-between rounded-lg px-3 py-2 text-[13px] ${
              conv.id === activeConversationId ? 'bg-[var(--accent-bg)]' : 'hover:bg-[var(--bg-hover)]'
            }`}
          >
            <div className="min-w-0">
              <div className="truncate">{conv.title}</div>
              {conv.model && (
                <div className="truncate text-[11px] text-[var(--text-muted)]">{conv.model}</div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className="text-[11px] text-[var(--text-muted)] group-hover:hidden">
                {relativeTime(conv.updated_at)}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpenFor(menuOpenFor === conv.id ? null : conv.id)
                }}
                className="hidden rounded px-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] group-hover:block"
              >
                ⋯
              </button>
            </div>
            {menuOpenFor === conv.id && (
              <div className="absolute top-full right-2 z-10 mt-1 w-32 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] py-1 text-[13px] shadow-lg">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    const title = prompt('Rename conversation', conv.title)
                    if (title) renameConversation(conv.id, title)
                    setMenuOpenFor(null)
                  }}
                  className="block w-full px-3 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                >
                  Rename
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteConversation(conv.id)
                    setMenuOpenFor(null)
                  }}
                  className="block w-full px-3 py-1.5 text-left text-[var(--danger)] hover:bg-[var(--bg-hover)]"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <button
        onClick={handleNewChat}
        className="m-2 rounded-lg border border-[var(--border)] px-3 py-2 text-[13px] hover:bg-[var(--bg-hover)]"
      >
        + New chat
      </button>
    </aside>
  )
}
