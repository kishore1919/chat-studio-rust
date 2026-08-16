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
    <div className="group/timeline pointer-events-none absolute right-0 top-0 bottom-0 z-30 flex w-12 items-center justify-end pr-2 select-none">
      {/* Vertical line indicator track (minimalist as in screenshot) */}
      <div className="pointer-events-auto flex flex-col items-end gap-3 py-6 px-1 opacity-40 transition-opacity duration-200 group-hover/timeline:opacity-100">
        {turns.map((turn, index) => {
          const isHovered = hoveredIndex === index
          const isCurrent =
            activeMessageId === turn.userMessage.id ||
            activeMessageId === turn.assistantMessage?.id ||
            (activeMessageId == null && index === turns.length - 1)

          // Clean text previews matching exact screenshot
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
              {/* Floating Preview Card matching the screenshot */}
              {isHovered && (
                <div
                  onClick={() => onScrollToMessage(turn.userMessage.id)}
                  className="absolute right-6 top-1/2 -translate-y-1/2 z-50 w-64 rounded-xl border border-border/80 bg-[#1e1f26]/95 text-left p-3 shadow-2xl backdrop-blur-md transition-all animate-in fade-in zoom-in-95 cursor-pointer pointer-events-auto"
                >
                  <div className="font-semibold text-[13px] text-white line-clamp-2 leading-snug">
                    {userPreview}
                  </div>
                  {assistantPreview && (
                    <div className="mt-1 text-[12px] text-neutral-400 line-clamp-3 leading-relaxed">
                      {assistantPreview}
                    </div>
                  )}
                </div>
              )}

              {/* Horizontal Line Dash */}
              <button
                type="button"
                onClick={() => onScrollToMessage(turn.userMessage.id)}
                className={`block rounded-full transition-all duration-150 cursor-pointer ${
                  isHovered || isCurrent
                    ? 'h-[2px] w-6 bg-white shadow-xs'
                    : 'h-[1.5px] w-3 bg-neutral-600 hover:w-5 hover:bg-neutral-300'
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
