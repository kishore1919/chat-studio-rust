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
  activeMessageId,
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
    <div className="group/timeline absolute right-0 top-0 bottom-0 z-30 flex w-10 items-center justify-end select-none pointer-events-auto">
      {/* Small, ultra-subtle vertical dash rail with generous hover detection */}
      <div className="flex flex-col items-end gap-1 py-4 pr-1.5 opacity-30 transition-opacity duration-200 group-hover/timeline:opacity-100">
        {turns.map((turn, index) => {
          const isHovered = hoveredIndex === index
          const isCurrent =
            activeMessageId === turn.userMessage.id ||
            activeMessageId === turn.assistantMessage?.id ||
            (activeMessageId == null && index === turns.length - 1)

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
              {/* Compact, sleek hover card with click navigation */}
              {isHovered && (
                <div
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onScrollToMessage(turn.userMessage.id)
                  }}
                  className="absolute right-7 top-1/2 -translate-y-1/2 z-50 w-60 rounded-xl border border-border/80 bg-popover/95 p-2.5 text-left shadow-xl backdrop-blur-md transition-all animate-in fade-in zoom-in-95 cursor-pointer"
                >
                  <div className="font-semibold text-[12px] text-foreground line-clamp-2 leading-snug">
                    {userPreview}
                  </div>
                  {assistantPreview && (
                    <div className="mt-1 text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                      {assistantPreview}
                    </div>
                  )}
                  <div className="mt-1.5 text-right font-mono text-[9px] text-primary/80 font-medium">
                    Click to jump ↵
                  </div>
                </div>
              )}

              {/* Generous clickable hitbox containing the minimal dash line */}
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
                      ? 'h-[2px] w-5 bg-foreground'
                      : isCurrent
                        ? 'h-[2px] w-3.5 bg-foreground/90'
                        : 'h-[1.5px] w-2 bg-muted-foreground/40 group-hover/btn:w-4 group-hover/btn:bg-foreground'
                  }`}
                />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
