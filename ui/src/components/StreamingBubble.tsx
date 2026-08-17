import { MarkdownContent } from './MarkdownContent'
import { ThinkingBar, extractThinking } from './ThinkingBar'
import { useStreamingMessage } from '../store/chat'

/** The only component that subscribes to the streaming slice. Renders
 * markdown live while tokens arrive; the settled MessageBubble takes over
 * once the stream completes. Isolated so settled messages never re-render mid-stream. */
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
    <div className="flex justify-start px-4 py-3">
      <div className="max-w-[92%] min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2 text-[12px]">
          <span className="font-semibold text-foreground">Assistant</span>
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />
        </div>

          {displayReasoning && (
            <ThinkingBar reasoning={displayReasoning} isStreaming={isThinkingActive} />
          )}

          {displayText && (
            <div className="relative">
              <MarkdownContent content={displayText} />
              <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-primary align-text-bottom" />
            </div>
          )}
      </div>
    </div>
  )
}
