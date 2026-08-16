import { ThinkingBar, extractThinking } from './ThinkingBar'
import { useStreamingMessage } from '../store/chat'

/** The only component that subscribes to the streaming slice. Renders plain
 * text (no markdown parse) while tokens arrive; the settled MessageBubble
 * takes over with full markdown once the stream completes. Isolating this
 * from the message list means settled messages never re-render mid-stream. */
export function StreamingBubble() {
  const streaming = useStreamingMessage()
  if (!streaming) return null

  const hasReasoning = !!streaming.reasoning
  let displayReasoning = streaming.reasoning
  let displayText = streaming.text

  if (!hasReasoning && streaming.text.includes('<think>')) {
    const extracted = extractThinking(streaming.text)
    displayReasoning = extracted.reasoning || ''
    displayText = extracted.cleanedContent
  }

  const isThinkingActive = hasReasoning && !displayText

  return (
    <div className="flex justify-start px-4 py-2">
      <div className="max-w-[92%] min-w-0">
        <div className="rounded-2xl rounded-tl-xs bg-[var(--bubble-assistant)] border border-border/70 px-4 py-3 shadow-xs">
          <div className="mb-2 flex items-center gap-2 text-[12px]">
            <span className="font-semibold text-foreground">Assistant</span>
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />
          </div>

          {displayReasoning && (
            <ThinkingBar reasoning={displayReasoning} isStreaming={isThinkingActive} />
          )}

          {displayText && (
            <div className="text-[14px] leading-relaxed whitespace-pre-wrap break-words text-foreground font-sans">
              {displayText}
              <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-primary align-text-bottom" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
