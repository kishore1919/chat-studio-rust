import { useEffect, useState } from 'react'
import { Sidebar } from '../components/Sidebar'
import { ChatHeader } from '../components/ChatHeader'
import { MessageList } from '../components/MessageList'
import { Composer } from '../components/Composer'
import { EmptyChatState } from '../components/EmptyChatState'
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
    <div className="flex h-full w-full overflow-hidden bg-background">
      <Sidebar collapsed={sidebarCollapsed} />
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <ChatHeader
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
          onOpenSettings={onOpenSettings}
        />
        {activeConversationId === null ? (
          <EmptyChatState />
        ) : (
          <MessageList conversationId={activeConversationId} />
        )}
        <Composer />
      </div>
    </div>
  )
}
