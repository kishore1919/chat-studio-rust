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
    <div className="absolute right-2 top-1/2 -translate-y-1/2 z-30 flex flex-col items-end gap-2.5 py-4 px-1 select-none pointer-events-auto">
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
            className="relative flex items-center justify-end group"
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            {/* Floating Preview Card on Hover */}
            {isHovered && (
              <div
                onClick={() => onScrollToMessage(turn.userMessage.id)}
                className="absolute right-7 top-1/2 -translate-y-1/2 z-40 w-72 rounded-xl border border-border/80 bg-card/95 p-3 text-left shadow-2xl backdrop-blur-md transition-all animate-in fade-in zoom-in-95 cursor-pointer pointer-events-auto"
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
                isHovered || isCurrent
                  ? 'h-[2.5px] w-6 bg-foreground shadow-xs'
                  : 'h-[2px] w-3 bg-muted-foreground/40 hover:w-5 hover:bg-foreground/80'
              }`}
              title={`Turn #${index + 1}: ${userPreview}`}
            />
          </div>
        )
      })}
    </div>
  )
}
