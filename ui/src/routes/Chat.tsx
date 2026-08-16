import { useEffect, useState } from 'react'
import { Sidebar } from '../components/Sidebar'
import { ChatHeader } from '../components/ChatHeader'
import { MessageList } from '../components/MessageList'
import { Composer } from '../components/Composer'
import { ErrorToast } from '../components/ErrorToast'
import { useChatStore } from '../store/chat'

interface ChatProps {
  onOpenSettings: () => void
}

export function Chat({ onOpenSettings }: ChatProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const activeConversationId = useChatStore((s) => s.activeConversationId)

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        onOpenSettings()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onOpenSettings])

  return (
    <div className="flex h-full">
      <Sidebar collapsed={sidebarCollapsed} />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <ErrorToast />
        <ChatHeader
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
          onOpenSettings={onOpenSettings}
        />
        {activeConversationId === null ? (
          <div className="flex flex-1 items-center justify-center text-[var(--text-muted)]">
            Select or start a conversation
          </div>
        ) : (
          <MessageList conversationId={activeConversationId} />
        )}
        <Composer />
      </div>
    </div>
  )
}
