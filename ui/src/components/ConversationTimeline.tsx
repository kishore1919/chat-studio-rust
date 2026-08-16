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
    <div className="group/timeline pointer-events-none absolute right-0 top-0 bottom-0 z-30 flex w-8 items-center justify-end pr-1 select-none">
      {/* Small, ultra-subtle vertical dash rail */}
      <div className="pointer-events-auto flex flex-col items-end gap-1.5 py-4 px-0.5 opacity-20 transition-opacity duration-300 group-hover/timeline:opacity-90">
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
              className="relative flex items-center justify-end py-0.5"
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              {/* Compact, sleek hover card */}
              {isHovered && (
                <div
                  onClick={() => onScrollToMessage(turn.userMessage.id)}
                  className="absolute right-5 top-1/2 -translate-y-1/2 z-50 w-56 rounded-lg border border-border/80 bg-popover/95 p-2.5 text-left shadow-lg backdrop-blur-md transition-all animate-in fade-in zoom-in-95 cursor-pointer pointer-events-auto"
                >
                  <div className="font-semibold text-[11.5px] text-foreground line-clamp-2 leading-snug">
                    {userPreview}
                  </div>
                  {assistantPreview && (
                    <div className="mt-1 text-[10.5px] text-muted-foreground line-clamp-2 leading-relaxed">
                      {assistantPreview}
                    </div>
                  )}
                </div>
              )}

              {/* Minimal small dash indicator */}
              <button
                type="button"
                onClick={() => onScrollToMessage(turn.userMessage.id)}
                className={`block rounded-full transition-all duration-150 cursor-pointer ${
                  isHovered || isCurrent
                    ? 'h-[1.5px] w-4 bg-foreground'
                    : 'h-[1px] w-2 bg-muted-foreground/40 hover:w-3 hover:bg-foreground/80'
                }`}
                title={userPreview}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
