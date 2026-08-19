import { useEffect, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { useChatStore, useConversationMessages } from '../store/chat'
import { MessageBubble } from './MessageBubble'
import { StreamingBubble } from './StreamingBubble'
import { EmptyChatState } from './EmptyChatState'
import { ConversationTimeline } from './ConversationTimeline'
import { MessageErrorBoundary } from './MessageErrorBoundary'

interface MessageListProps {
  conversationId: number
  targetMessageId?: number | null
}

/** Renders only the visible window of messages (react-virtuoso), with
 * `followOutput` to stick to bottom while streaming and a top-reached
 * callback that lazily loads older pages - this is what keeps memory flat
 * as a conversation grows into the hundreds of messages. */
export function MessageList({ conversationId, targetMessageId }: MessageListProps) {
  const messages = useConversationMessages(conversationId)
  const hasMore = useChatStore((s) => s.hasMoreByConversation[conversationId] ?? false)
  const loadOlderMessages = useChatStore((s) => s.loadOlderMessages)
  const streaming = useChatStore((s) => s.streaming)
  const virtuosoRef = useRef<VirtuosoHandle>(null)

  const isStreamingHere = streaming?.conversationId === conversationId
  const [activeMessageId, setActiveMessageId] = useState<number | null>(null)
  const [atBottom, setAtBottom] = useState(true)

  // StreamingBubble unmounts the instant the stream ends, so its own "is
  // responding" status region can never announce completion - this outlives
  // it and fires the transition.
  const wasStreamingRef = useRef(false)
  const [justCompleted, setJustCompleted] = useState(false)
  useEffect(() => {
    const wasStreaming = wasStreamingRef.current
    wasStreamingRef.current = isStreamingHere
    if (wasStreaming && !isStreamingHere) {
      setJustCompleted(true)
      const timer = setTimeout(() => setJustCompleted(false), 1000)
      return () => clearTimeout(timer)
    }
  }, [isStreamingHere])

  // `messages` is read through a ref in the target-message effect below
  // rather than declared as a dependency there: depending on the array
  // re-ran it on every streaming append, which yanked the viewport back to
  // the target mid-stream.
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  // Jump to the last message once per conversation switch - including on
  // the very first load. `selectConversation` sets `activeConversationId`
  // synchronously but the message fetch is async, so on a cold cache this
  // effect used to fire immediately against an empty array (scrolling to
  // index -1) and never again once the real page of messages arrived,
  // leaving the view wherever Virtuoso defaulted to (the top) instead of the
  // last message. Guarding on a per-conversation ref instead of depending on
  // `messages` directly re-fires exactly once the messages actually show up,
  // without re-triggering on every later append (streaming already handles
  // that via `followOutput`).
  const scrolledForRef = useRef<number | null>(null)
  useEffect(() => {
    if (messages.length === 0) return
    if (scrolledForRef.current === conversationId) return
    scrolledForRef.current = conversationId
    virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, align: 'end' })
    setActiveMessageId(messages[messages.length - 1]?.id ?? null)
  }, [conversationId, messages])

  useEffect(() => {
    if (targetMessageId === undefined || targetMessageId === null) return
    const targetIndex = messagesRef.current.findIndex((m) => m.id === targetMessageId)
    if (targetIndex === -1) return
    setActiveMessageId(targetMessageId)
    virtuosoRef.current?.scrollToIndex({
      index: targetIndex,
      align: 'start',
      behavior: 'smooth',
    })
  }, [targetMessageId])

  const handleScrollToMessage = (messageId: number) => {
    const targetIndex = messages.findIndex((m) => m.id === messageId)
    if (targetIndex !== -1 && virtuosoRef.current) {
      setActiveMessageId(messageId)
      virtuosoRef.current.scrollToIndex({
        index: targetIndex,
        align: 'start',
        behavior: 'smooth',
      })
    }
  }

  if (messages.length === 0 && !isStreamingHere) {
    return <EmptyChatState />
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <Virtuoso
        ref={virtuosoRef}
        className="flex-1 overflow-x-hidden"
        data={messages}
        increaseViewportBy={200}
        followOutput={isStreamingHere ? 'smooth' : false}
        atBottomStateChange={setAtBottom}
        startReached={() => {
          if (hasMore) loadOlderMessages(conversationId)
        }}
        rangeChanged={(range) => {
          const firstMsg = messages[range.startIndex]
          if (firstMsg) setActiveMessageId(firstMsg.id)
        }}
        itemContent={(_index, message) => (
          // Keyed by message id so a different message never inherits a
          // caught error state from whatever Virtuoso previously rendered at
          // this same list position.
          <MessageErrorBoundary key={message.id} fallbackText={message.content}>
            <MessageBubble message={message} />
          </MessageErrorBoundary>
        )}
        components={{
          Footer: () =>
            isStreamingHere ? (
              <MessageErrorBoundary fallbackText={streaming?.text ?? ''}>
                <StreamingBubble />
              </MessageErrorBoundary>
            ) : null,
        }}
      />
      {!atBottom && !isStreamingHere && messages.length > 4 && (
        <button
          type="button"
          onClick={() => virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, behavior: 'smooth' })}
          aria-label="Scroll to bottom"
          className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-md transition hover:bg-accent"
        >
          Jump to latest ↓
        </button>
      )}
      <ConversationTimeline
        messages={messages}
        activeMessageId={activeMessageId}
        onScrollToMessage={handleScrollToMessage}
      />
      {justCompleted && (
        <div role="status" aria-live="polite" className="sr-only">
          Response complete
        </div>
      )}
    </div>
  )
}
