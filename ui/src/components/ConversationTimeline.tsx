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

  // Only show if there is at least 1 turn
  if (turns.length === 0) return null

  return (
    <div className="group/timeline pointer-events-none absolute right-0 top-0 bottom-0 z-30 flex w-10 items-center justify-end pr-1.5 select-none">
      {/* Subtle background track that fades in on hover */}
      <div className="pointer-events-auto flex flex-col items-end gap-2.5 py-4 px-1 opacity-15 transition-opacity duration-300 group-hover/timeline:opacity-100">
        {turns.map((turn, index) => {
          const isHovered = hoveredIndex === index
          const isCurrent =
            activeMessageId === turn.userMessage.id ||
            activeMessageId === turn.assistantMessage?.id ||
            (activeMessageId == null && index === turns.length - 1)

          // Clean text previews
          const userPreview = turn.userMessage.content.trim().split('\n')[0] || 'User prompt'
          const assistantRaw = turn.assistantMessage?.content?.trim() || ''
          const assistantClean = assistantRaw
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/%%TOOL_CALL_\d+%%/g, '')
            .trim()
          const assistantPreview =
            assistantClean.split('\n')[0] || (turn.assistantMessage ? 'Assistant reply' : '')

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
                  onClick={() => onScrollToMessage(turn.userMessage.id)}
                  className="absolute right-6 top-1/2 -translate-y-1/2 z-50 w-64 rounded-xl border border-border/80 bg-popover/95 p-3 text-left shadow-xl backdrop-blur-md transition-all animate-in fade-in zoom-in-95 cursor-pointer pointer-events-auto"
                >
                  <div className="font-semibold text-xs text-foreground line-clamp-2 leading-snug">
                    {userPreview}
                  </div>
                  {assistantPreview && (
                    <div className="mt-1 text-[11px] text-muted-foreground line-clamp-3 leading-relaxed">
                      {assistantPreview}
                    </div>
                  )}
                </div>
              )}

              {/* Horizontal Line Dash */}
              <button
                type="button"
                onClick={() => onScrollToMessage(turn.userMessage.id)}
                className={`block rounded-full transition-all duration-200 cursor-pointer ${
                  isHovered
                    ? 'h-[2px] w-6 bg-foreground shadow-xs'
                    : isCurrent
                      ? 'h-[2px] w-4.5 bg-foreground/90'
                      : 'h-[1.5px] w-2.5 bg-muted-foreground/50 hover:w-5 hover:bg-foreground'
                }`}
                title={`Turn #${index + 1}: ${userPreview}`}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
