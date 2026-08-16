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

  const count = userMessages.length
  if (count === 0) return null

  // Adaptive scaling so timeline never stretches too long even with 50+ messages
  const isDense = count > 24
  const isUltraDense = count > 45

  return (
    <div
      className={`absolute right-3 top-1/2 -translate-y-1/2 z-40 flex flex-col items-end select-none pointer-events-auto max-h-[300px] ${
        isUltraDense ? 'gap-[2px]' : isDense ? 'gap-1' : 'gap-1.5'
      }`}
    >
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
                className="absolute right-7 top-1/2 -translate-y-1/2 z-50 w-56 rounded-xl border border-border/90 bg-[#1b1c24]/98 p-2.5 text-left shadow-2xl backdrop-blur-xl transition-all animate-in fade-in zoom-in-95 cursor-pointer pointer-events-auto"
              >
                <div className="font-semibold text-[12px] text-white line-clamp-3 leading-snug whitespace-pre-wrap break-words">
                  {promptText}
                </div>
                <div className="mt-1.5 flex items-center justify-between font-mono text-[9px] text-neutral-400">
                  <span>Input #{index + 1} of {count}</span>
                  <span className="text-primary/90 font-medium">Jump ↵</span>
                </div>
              </div>
            )}

            {/* Clickable Adaptive Dash Button */}
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onScrollToMessage(msg.id)
              }}
              className={`flex items-center justify-end pr-0.5 cursor-pointer group/btn ${
                isUltraDense ? 'h-2 w-5' : isDense ? 'h-3 w-6' : 'h-4.5 w-7'
              }`}
            >
              <span
                className={`block rounded-full transition-all duration-150 ${
                  isHovered
                    ? 'h-[2px] w-4.5 bg-white shadow-sm'
                    : isUltraDense
                      ? 'h-[1px] w-1.5 bg-neutral-500/70 group-hover/btn:w-3.5 group-hover/btn:bg-white'
                      : isDense
                        ? 'h-[1.2px] w-2 bg-neutral-500/70 group-hover/btn:w-3.5 group-hover/btn:bg-white'
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
