import { useEffect, useRef } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { useChatStore } from '../store/chat'
import { MessageBubble } from './MessageBubble'
import { StreamingBubble } from './StreamingBubble'
import type { Message } from '../lib/types'

interface MessageListProps {
  conversationId: number
}

// Stable reference so the zustand selector below never reports a "changed"
// value when there's no entry yet - `?? []` inline would allocate a new
// array every render, and zustand/React's snapshot comparison would see
// that as a perpetual change, causing an infinite render loop.
const EMPTY_MESSAGES: Message[] = []

/** Renders only the visible window of messages (react-virtuoso), with
 * `followOutput` to stick to bottom while streaming and a top-reached
 * callback that lazily loads older pages - this is what keeps memory flat
 * as a conversation grows into the hundreds of messages. */
export function MessageList({ conversationId }: MessageListProps) {
  const messages = useChatStore((s) => s.messagesByConversation[conversationId] ?? EMPTY_MESSAGES)
  const hasMore = useChatStore((s) => s.hasMoreByConversation[conversationId] ?? false)
  const loadOlderMessages = useChatStore((s) => s.loadOlderMessages)
  const streaming = useChatStore((s) => s.streaming)
  const virtuosoRef = useRef<VirtuosoHandle>(null)

  const isStreamingHere = streaming?.conversationId === conversationId

  useEffect(() => {
    // Reset scroll position when switching conversations.
    virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, align: 'end' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  return (
    <Virtuoso
      ref={virtuosoRef}
      className="flex-1"
      data={messages}
      followOutput={isStreamingHere ? 'smooth' : false}
      startReached={() => {
        if (hasMore) loadOlderMessages(conversationId)
      }}
      itemContent={(_index, message) => <MessageBubble message={message} />}
      components={{
        Footer: () => (isStreamingHere ? <StreamingBubble /> : null),
      }}
    />
  )
}
