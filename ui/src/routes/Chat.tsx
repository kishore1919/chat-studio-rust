import { useEffect, useState } from 'react'
import { Sidebar } from '../components/Sidebar'
import { ChatHeader } from '../components/ChatHeader'
import { MessageList } from '../components/MessageList'
import { Composer } from '../components/Composer'
import { EmptyChatState } from '../components/EmptyChatState'
import { MindMapPanel } from '../components/MindMapPanel'
import { useChatStore } from '../store/chat'

interface ChatProps {
  onOpenSettings: () => void
}

export function Chat({ onOpenSettings }: ChatProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [mindMapOpen, setMindMapOpen] = useState(false)
  const [targetMessageId, setTargetMessageId] = useState<number | null>(null)
  const activeConversationId = useChatStore((s) => s.activeConversationId)

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        onOpenSettings()
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault()
        setMindMapOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onOpenSettings])

  const handleSelectMessageFromMindMap = (msgId: number) => {
    setTargetMessageId(msgId)
    // Clear target after scroll to allow re-scrolling to the same node later
    setTimeout(() => setTargetMessageId(null), 300)
  }

  return (
    <div className="flex h-full w-full min-w-[720px] overflow-hidden bg-background">
      <Sidebar collapsed={sidebarCollapsed} />
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <ChatHeader
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
          onOpenSettings={onOpenSettings}
          mindMapOpen={mindMapOpen}
          onToggleMindMap={() => setMindMapOpen((v) => !v)}
        />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {activeConversationId === null ? (
              <EmptyChatState />
            ) : (
              <MessageList
                conversationId={activeConversationId}
                targetMessageId={targetMessageId}
              />
            )}
            <Composer />
          </div>
          {mindMapOpen && activeConversationId !== null && (
            <MindMapPanel
              onClose={() => setMindMapOpen(false)}
              onSelectMessage={handleSelectMessageFromMindMap}
            />
          )}
        </div>
      </div>
    </div>
  )
}

