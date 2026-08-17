import { MarkdownContent } from './MarkdownContent'
import { ThinkingBar, extractThinking } from './ThinkingBar'
import { MessageRow } from './MessageRow'
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
    <MessageRow className="py-3">
      <div className="mb-1 flex items-center gap-2 text-[12px]">
        <span className="rounded-md bg-primary/15 px-1.5 py-0.5 font-semibold text-primary">Assistant</span>
        <span aria-hidden="true" className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />
      </div>

      {displayReasoning && <ThinkingBar reasoning={displayReasoning} isStreaming={isThinkingActive} />}

      {displayText && (
        <div className="relative">
          <MarkdownContent content={displayText} />
          <span aria-hidden="true" className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-primary align-text-bottom" />
        </div>
      )}

      {/* Announces status only, never the streaming text itself - piping
          25Hz-updating content into a polite live region would flood and
          starve the screen reader. The settled content is readable once the
          stream finishes, which is where AT users would navigate anyway. */}
      <div role="status" aria-live="polite" className="sr-only">
        {displayText ? 'Assistant is responding' : 'Assistant is thinking'}
      </div>
    </MessageRow>
  )
}
