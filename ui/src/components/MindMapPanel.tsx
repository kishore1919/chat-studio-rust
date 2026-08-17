import { useMemo, useState } from 'react'
import {
  ChevronRightIcon,
  GitBranchIcon,
  RotateCcwIcon,
  SearchIcon,
  SparklesIcon,
  UserIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react'
import { useChatStore } from '../store/chat'
import type { Message } from '../lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface MindMapPanelProps {
  onClose: () => void
  onSelectMessage?: (messageId: number) => void
}

function formatTime(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function truncateText(text: string, maxLen = 48) {
  const firstLine = text.trim().split('\n')[0] ?? ''
  if (firstLine.length <= maxLen) return firstLine
  return `${firstLine.slice(0, maxLen)}...`
}

export function MindMapPanel({ onClose, onSelectMessage }: MindMapPanelProps) {
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const conversations = useChatStore((s) => s.conversations)
  const messagesByConversation = useChatStore((s) => s.messagesByConversation)

  const [search, setSearch] = useState('')
  const [zoom, setZoom] = useState(1)
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null)

  const activeConv = conversations.find((c) => c.id === activeConversationId)
  const messages = (activeConversationId ? messagesByConversation[activeConversationId] : []) ?? []

  // Extract all user input messages
  const userMessages = useMemo(() => {
    return messages.filter((m) => m.role === 'user')
  }, [messages])

  // Filtered nodes based on search
  const filteredNodes = useMemo(() => {
    if (!search.trim()) return userMessages
    const q = search.toLowerCase()
    return userMessages.filter((m) => m.content.toLowerCase().includes(q))
  }, [userMessages, search])

  const handleNodeClick = (message: Message) => {
    setSelectedNodeId(message.id)
    if (onSelectMessage) {
      onSelectMessage(message.id)
    }
  }

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.15, 1.8))
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.15, 0.6))
  const handleResetZoom = () => setZoom(1)

  return (
    <aside className="flex h-full w-80 flex-col border-l border-border/40 bg-card/60 backdrop-blur-md select-none">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/40 px-3">
        <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
          <GitBranchIcon className="size-4 text-primary shrink-0" />
          <span>Input Mind Map</span>
          <span className="rounded-full bg-primary/10 px-1.5 py-0.2 text-[10px] font-mono text-primary">
            {userMessages.length}
          </span>
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          className="size-7 text-muted-foreground hover:text-foreground"
          title="Close Mind Map"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>

      {/* Search & Zoom Controls */}
      <div className="flex items-center gap-2 border-b border-border/50 p-2 text-xs">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2.5 top-2 size-3 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter inputs..."
            className="h-7 pl-7 text-[11px]"
          />
        </div>

        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleZoomOut}
            className="size-6 text-muted-foreground hover:text-foreground"
            title="Zoom out"
          >
            <ZoomOutIcon className="size-3" />
          </Button>
          <span className="w-7 text-center font-mono text-[10px] text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleZoomIn}
            className="size-6 text-muted-foreground hover:text-foreground"
            title="Zoom in"
          >
            <ZoomInIcon className="size-3" />
          </Button>
          {zoom !== 1 && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleResetZoom}
              className="size-6 text-muted-foreground hover:text-foreground"
              title="Reset zoom"
            >
              <RotateCcwIcon className="size-2.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3">
        {userMessages.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-center text-xs text-muted-foreground">
            <GitBranchIcon className="mb-2 size-8 stroke-1 text-muted-foreground/40" />
            <p className="font-medium">No input messages yet</p>
            <p className="text-[11px] text-muted-foreground/70">
              Send messages in chat to view mind map connections
            </p>
          </div>
        ) : (
          <div
            className="transition-transform origin-top-left"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
          >
            {/* Root Conversation Node */}
            <div className="relative mb-6 rounded-xl border border-primary/30 bg-primary/10 p-2.5 shadow-xs">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                <SparklesIcon className="size-3.5 shrink-0" />
                <span className="truncate">{activeConv?.title || 'Chat Conversation'}</span>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                Origin ({userMessages.length} total prompts)
              </div>
              {/* Connecting line anchor */}
              <div className="absolute -bottom-6 left-6 h-6 w-0.5 bg-gradient-to-b from-primary/50 to-border" />
            </div>

            {/* Input Message Line Tree */}
            <div className="relative pl-6 space-y-4">
              {/* Vertical trunk line */}
              <div className="absolute left-6 top-0 bottom-4 w-0.5 bg-border/80" />

              {filteredNodes.map((msg, index) => {
                const isSelected = selectedNodeId === msg.id
                const summary = truncateText(msg.content, 42)

                return (
                  <div key={msg.id} className="relative flex items-start group">
                    {/* Horizontal Branch Connector Line */}
                    <div className="absolute -left-6 top-3.5 h-0.5 w-6 bg-border/80 group-hover:bg-primary/60 transition-colors" />

                    {/* Node Dot */}
                    <div
                      className={`absolute -left-[27px] top-2.5 size-3 rounded-full border-2 transition-all ${
                        isSelected
                          ? 'border-primary bg-primary ring-2 ring-primary/30'
                          : 'border-border bg-card group-hover:border-primary group-hover:bg-primary/20'
                      }`}
                    />

                    {/* Node Card */}
                    <button
                      type="button"
                      onClick={() => handleNodeClick(msg)}
                      className={`flex flex-col w-full text-left rounded-xl border p-2.5 transition-all cursor-pointer shadow-xs ${
                        isSelected
                          ? 'border-primary/80 bg-accent shadow-sm'
                          : 'border-border/70 bg-[var(--bubble-user)]/40 hover:border-primary/50 hover:bg-accent/50'
                      }`}
                      title={msg.content}
                    >
                      <div className="flex items-center justify-between gap-1 text-[11px]">
                        <div className="flex items-center gap-1 font-semibold text-foreground">
                          <UserIcon className="size-3 text-primary shrink-0" />
                          <span>Input #{index + 1}</span>
                        </div>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {formatTime(msg.created_at)}
                        </span>
                      </div>

                      <p className="mt-1 text-[11.5px] leading-snug text-foreground/90 font-medium line-clamp-2">
                        {summary}
                      </p>

                      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{msg.content.length} chars</span>
                        <span className="flex items-center gap-0.5 text-primary opacity-0 group-hover:opacity-100 transition-opacity font-medium">
                          View in chat <ChevronRightIcon className="size-2.5" />
                        </span>
                      </div>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
