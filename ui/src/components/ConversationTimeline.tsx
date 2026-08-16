import { useMemo, useState } from 'react'
import type { Message } from '../lib/types'

interface ConversationTimelineProps {
  messages: Message[]
  onScrollToMessage: (messageId: number) => void
  activeMessageId?: number | null
}

interface MessageTurn {
  userMessage: Message
  assistantMessage?: Message
}

export function ConversationTimeline({
  messages,
  onScrollToMessage,
}: ConversationTimelineProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  // Group messages into (User Prompt, Assistant Response) turns
  const turns = useMemo(() => {
    const list: MessageTurn[] = []
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === 'user') {
        const userMessage = messages[i]
        const nextMsg = messages[i + 1]
        const assistantMessage = nextMsg?.role === 'assistant' ? nextMsg : undefined
        list.push({ userMessage, assistantMessage })
      }
    }
    return list
  }, [messages])

  if (turns.length === 0) return null

  return (
    <div className="absolute right-1 top-1/2 -translate-y-1/2 z-30 flex flex-col items-end gap-1 p-1 select-none pointer-events-auto max-h-[80vh] overflow-y-auto">
      {turns.map((turn, index) => {
        const isHovered = hoveredIndex === index

        // Clean text previews
        const userPreview = turn.userMessage.content.trim().split('\n')[0] || 'Prompt'
        const assistantRaw = turn.assistantMessage?.content?.trim() || ''
        const assistantClean = assistantRaw
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .replace(/%%TOOL_CALL_\d+%%/g, '')
          .trim()
        const assistantPreview =
          assistantClean.split('\n')[0] || (turn.assistantMessage ? '...' : '')

        return (
          <div
            key={turn.userMessage.id}
            className="relative flex items-center justify-end"
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            {/* Floating Preview Card on Hover */}
            {isHovered && (
              <div
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onScrollToMessage(turn.userMessage.id)
                }}
                className="absolute right-8 top-1/2 -translate-y-1/2 z-50 w-64 rounded-xl border border-border bg-popover/98 p-3 text-left shadow-2xl backdrop-blur-md transition-all animate-in fade-in zoom-in-95 cursor-pointer"
              >
                <div className="font-semibold text-[12.5px] text-foreground line-clamp-2 leading-snug">
                  {userPreview}
                </div>
                {assistantPreview && (
                  <div className="mt-1 text-[11.5px] text-muted-foreground line-clamp-3 leading-relaxed">
                    {assistantPreview}
                  </div>
                )}
                <div className="mt-1.5 text-right font-mono text-[9.5px] text-primary font-medium">
                  Click to jump ↵
                </div>
              </div>
            )}

            {/* Clickable Dash: Highlights only when hovered */}
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onScrollToMessage(turn.userMessage.id)
              }}
              className="flex h-5 w-8 items-center justify-end pr-0.5 cursor-pointer group/btn"
              title={`Turn #${index + 1}: ${userPreview}`}
            >
              <span
                className={`block rounded-full transition-all duration-150 ${
                  isHovered
                    ? 'h-[2.5px] w-6 bg-foreground shadow-sm'
                    : 'h-[2px] w-3.5 bg-muted-foreground/40 group-hover/btn:w-5 group-hover/btn:bg-foreground'
                }`}
              />
            </button>
          </div>
        )
      })}
    </div>
  )
}
