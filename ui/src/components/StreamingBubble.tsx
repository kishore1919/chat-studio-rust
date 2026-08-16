import { useState } from 'react'
import { useStreamingMessage } from '../store/chat'

/** The only component that subscribes to the streaming slice. Renders plain
 * text (no markdown parse) while tokens arrive; the settled MessageBubble
 * takes over with full markdown once the stream completes. Isolating this
 * from the message list means settled messages never re-render mid-stream. */
export function StreamingBubble() {
  const streaming = useStreamingMessage()
  const [reasoningOpen, setReasoningOpen] = useState(true)
  if (!streaming) return null

  return (
    <div className="px-4 py-2">
      <div className="mb-1 flex items-center gap-2 text-[13px]">
        <span className="font-semibold">Assistant</span>
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
      </div>
      {streaming.reasoning && (
        <div className="mb-2">
          <button
            onClick={() => setReasoningOpen((v) => !v)}
            className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            Thinking... {reasoningOpen ? '▾' : '›'}
          </button>
          {reasoningOpen && (
            <div className="mt-1 rounded-md border-l-2 border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[12px] whitespace-pre-wrap text-[var(--text-muted)]">
              {streaming.reasoning}
            </div>
          )}
        </div>
      )}
      <div className="text-[14px] leading-relaxed whitespace-pre-wrap break-words">
        {streaming.text}
        <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-[var(--accent)] align-text-bottom" />
      </div>
    </div>
  )
}
