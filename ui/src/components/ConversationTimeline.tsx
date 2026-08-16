import { useMemo, useState } from 'react'
import type { Message } from '../lib/types'

interface ConversationTimelineProps {
  messages: Message[]
  onScrollToMessage: (messageId: number) => void
  activeMessageId?: number | null
}

export function ConversationTimeline({
  messages,
  onScrollToMessage,
}: ConversationTimelineProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  // Extract all user input messages
  const userMessages = useMemo(() => {
    return messages.filter((m) => m.role === 'user')
  }, [messages])

  if (userMessages.length === 0) return null

  return (
    <div className="absolute right-3.5 top-1/2 -translate-y-1/2 z-40 flex flex-col items-end gap-1.5 select-none pointer-events-auto">
      {userMessages.map((msg, index) => {
        const isHovered = hoveredIndex === index
        const promptText = msg.content.trim()

        return (
          <div
            key={msg.id}
            className="relative flex items-center justify-end"
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            {/* Floating Preview Card: Shows only the User Message */}
            {isHovered && (
              <div
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onScrollToMessage(msg.id)
                }}
                className="absolute right-8 top-1/2 -translate-y-1/2 z-50 w-60 rounded-xl border border-border/90 bg-[#1b1c24]/98 p-3 text-left shadow-2xl backdrop-blur-xl transition-all animate-in fade-in zoom-in-95 cursor-pointer pointer-events-auto"
              >
                <div className="font-semibold text-[12.5px] text-white line-clamp-4 leading-snug whitespace-pre-wrap break-words">
                  {promptText}
                </div>
                <div className="mt-2 flex items-center justify-between font-mono text-[9.5px] text-neutral-400">
                  <span>Input #{index + 1}</span>
                  <span className="text-primary/90 font-medium">Click to jump ↵</span>
                </div>
              </div>
            )}

            {/* Clickable Dash Button */}
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onScrollToMessage(msg.id)
              }}
              className="flex h-5 w-7 items-center justify-end pr-0.5 cursor-pointer group/btn"
            >
              <span
                className={`block rounded-full transition-all duration-150 ${
                  isHovered
                    ? 'h-[2.5px] w-5 bg-white shadow-sm'
                    : 'h-[1.5px] w-2.5 bg-neutral-500/70 group-hover/btn:w-4 group-hover/btn:bg-white'
                }`}
              />
            </button>
          </div>
        )
      })}
    </div>
  )
}
