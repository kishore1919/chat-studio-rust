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

const SIDEBAR_COLLAPSED_KEY = 'chat-studio-sidebar-collapsed'

export function Chat({ onOpenSettings }: ChatProps) {
  // A chat app's conversation list should be visible by default - hover-to-
  // reveal (when collapsed) is a power-user affordance, not a default. Once
  // the user picks a state, it's remembered across launches.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true',
  )
  const [mindMapOpen, setMindMapOpen] = useState(false)
  const [targetMessageId, setTargetMessageId] = useState<number | null>(null)
  const activeConversationId = useChatStore((s) => s.activeConversationId)

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed))
  }, [sidebarCollapsed])

  useEffect(() => {
    // App.tsx swaps Chat<->Settings by conditional render, so Chat fully
    // unmounts/remounts on each transition - this fires both on first load
    // and every time the user returns from Settings, restoring focus to
    // where the previous session's <body> focus (from Settings' back
    // button) would otherwise have left it.
    document.getElementById('composer-textarea')?.focus()
  }, [])

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        onOpenSettings()
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault()
        setMindMapOpen((v) => !v)
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault()
        setSidebarCollapsed((v) => !v)
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
    <div className="flex h-full w-full overflow-hidden bg-background">
      <Sidebar
        collapsed={sidebarCollapsed}
        onExpand={() => setSidebarCollapsed(false)}
        onOpenSettings={onOpenSettings}
      />
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

