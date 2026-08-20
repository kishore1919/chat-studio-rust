import { useMemo, useState } from 'react'
import { CornerDownLeftIcon } from 'lucide-react'
import type { Message } from '../lib/types'

interface ConversationTimelineProps {
  messages: Message[]
  onScrollToMessage: (messageId: number) => void
  activeMessageId?: number | null
}

const MAX_TICKS = 16

export function ConversationTimeline({
  messages,
  onScrollToMessage,
}: ConversationTimelineProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  // Extract all user input messages
  const userMessages = useMemo(() => {
    return messages.filter((m) => m.role === 'user')
  }, [messages])

  const totalCount = userMessages.length

  // If there are many messages, sample evenly so the timeline widget ALWAYS stays compact (~160px tall)
  const sampledTicks = useMemo(() => {
    if (totalCount === 0) return []
    if (totalCount <= MAX_TICKS) {
      return userMessages.map((msg, idx) => ({
        msg,
        displayNumber: idx + 1,
        key: msg.id,
      }))
    }

    const result: Array<{ msg: Message; displayNumber: number; key: number }> = []
    const step = (totalCount - 1) / (MAX_TICKS - 1)
    const usedIndices = new Set<number>()

    for (let i = 0; i < MAX_TICKS; i++) {
      const idx = Math.min(Math.round(i * step), totalCount - 1)
      if (!usedIndices.has(idx)) {
        usedIndices.add(idx)
        result.push({
          msg: userMessages[idx],
          displayNumber: idx + 1,
          key: userMessages[idx].id,
        })
      }
    }
    return result
  }, [userMessages, totalCount])

  if (totalCount === 0) return null

  return (
    <div className="absolute right-6 top-1/2 -translate-y-1/2 z-40 flex flex-col items-end gap-1.5 select-none pointer-events-auto">
      {sampledTicks.map((item, index) => {
        const isHovered = hoveredIndex === index
        const promptText = item.msg.content.trim()

        return (
          <div
            key={item.key}
            className="relative flex items-center justify-end"
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            {/* Floating Preview Card */}
            {isHovered && (
              <div
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onScrollToMessage(item.msg.id)
                }}
                className="absolute right-8 top-1/2 -translate-y-1/2 z-50 w-60 rounded-xl border border-border/90 bg-popover/98 p-2.5 text-left shadow-2xl backdrop-blur-xl transition-all animate-in fade-in zoom-in-95 cursor-pointer pointer-events-auto"
              >
                <div className="font-semibold text-[12px] text-popover-foreground line-clamp-3 leading-snug whitespace-pre-wrap break-words">
                  {promptText}
                </div>
                <div className="mt-1.5 flex items-center justify-between font-mono text-[9px] text-muted-foreground">
                  <span>Input #{item.displayNumber} of {totalCount}</span>
                  <span className="inline-flex items-center gap-0.5 text-primary/90 font-medium">
                    Jump <CornerDownLeftIcon className="size-2.5" />
                  </span>
                </div>
              </div>
            )}


            {/* Clickable Dash Button */}
            <button
              type="button"
              aria-label={`Jump to message ${item.displayNumber} of ${totalCount}`}
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onScrollToMessage(item.msg.id)
              }}
              className="group/btn flex h-3 w-6 cursor-pointer items-center justify-end pr-0.5"
            >
              <span
                className={`block rounded-full transition-all duration-150 ${
                  isHovered
                    ? 'h-[2px] w-4.5 bg-foreground shadow-sm'
                    : 'h-[1.5px] w-2.5 bg-muted-foreground/70 group-hover/btn:w-4 group-hover/btn:bg-foreground'
                }`}
              />
            </button>
          </div>
        )
      })}
    </div>
  )
}
