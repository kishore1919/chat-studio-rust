import { useMemo, useState } from 'react'
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
  activeMessageId,
}: ConversationTimelineProps) {
  // Keyboard-focus only, not mouse hover - the hover preview popup and the
  // tick-grows-on-hover effect were removed per feedback.
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)

  // Extract all user input messages
  const userMessages = useMemo(() => messages.filter((m) => m.role === 'user'), [messages])
  const totalCount = userMessages.length

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
    const used = new Set<number>()
    for (let i = 0; i < MAX_TICKS; i++) {
      const idx = Math.min(Math.round(i * step), totalCount - 1)
      if (!used.has(idx)) {
        used.add(idx)
        result.push({ msg: userMessages[idx], displayNumber: idx + 1, key: userMessages[idx].id })
      }
    }
    return result
  }, [userMessages, totalCount])

  if (totalCount === 0) return null

  return (
    <nav
      aria-label="Conversation timeline"
      className="absolute right-2 top-1/2 z-40 flex -translate-y-1/2 flex-col items-end gap-1.5 rounded-full border border-border/60 bg-card/60 py-2 pl-1 pr-1.5 backdrop-blur select-none pointer-events-auto"
    >
      {sampledTicks.map((item, index) => {
        const isFocused = focusedIndex === index
        const isActive = item.msg.id === activeMessageId
        const promptText = item.msg.content.trim()

        return (
          <div key={item.key} className="relative flex items-center justify-end">
            {/* Preview card shown on keyboard focus only. */}
            {isFocused && (
              <div
                onClick={() => onScrollToMessage(item.msg.id)}
                className="absolute right-8 top-1/2 -translate-y-1/2 z-50 w-60 rounded-xl border border-border/90 bg-popover/98 p-2.5 text-left shadow-2xl backdrop-blur-xl transition-all animate-in fade-in zoom-in-95 cursor-pointer pointer-events-auto"
              >
                <div className="font-semibold text-[12px] text-popover-foreground line-clamp-3 leading-snug whitespace-pre-wrap break-words">
                  {promptText}
                </div>
                <div className="mt-1.5 flex items-center justify-between font-mono text-[9px] text-muted-foreground">
                  <span>Input #{item.displayNumber} of {totalCount}</span>
                  <span className="text-primary/90 font-medium">Jump ↵</span>
                </div>
              </div>
            )}

            <button
              type="button"
              aria-label={`Jump to message ${item.displayNumber} of ${totalCount}`}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => onScrollToMessage(item.msg.id)}
              onFocus={() => setFocusedIndex(index)}
              onBlur={() => setFocusedIndex(null)}
              className="flex h-3 w-6 cursor-pointer items-center justify-end pr-0.5"
            >
              <span
                className={`block rounded-full transition-colors duration-150 ${
                  isActive ? 'h-[2px] w-4.5 bg-foreground shadow-sm' : 'h-[1.5px] w-2.5 bg-muted-foreground/70'
                }`}
              />
            </button>
          </div>
        )
      })}
    </nav>
  )
}
