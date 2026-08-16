import { useRef, useState, type KeyboardEvent } from 'react'
import { useChatStore } from '../store/chat'

export function Composer() {
  const [text, setText] = useState('')
  const sendMessage = useChatStore((s) => s.sendMessage)
  const cancelStream = useChatStore((s) => s.cancelStream)
  const isStreaming = useChatStore((s) => s.streaming !== null)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = () => {
    const trimmed = text.trim()
    if (!trimmed || isStreaming || activeConversationId === null) return
    setText('')
    sendMessage(trimmed)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    } else if (e.key === 'Escape' && isStreaming) {
      e.preventDefault()
      cancelStream()
    }
  }

  return (
    <div className="border-t border-[var(--border)] p-3">
      <div className="flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message. Press Enter to send, Shift+Enter for a new line."
          rows={1}
          disabled={activeConversationId === null}
          className="max-h-40 min-h-6 flex-1 resize-none bg-transparent text-[14px] outline-none placeholder:text-[var(--text-muted)]"
        />
        {isStreaming ? (
          <button
            onClick={cancelStream}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--danger)] text-white"
            title="Stop (Esc)"
          >
            ■
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim() || activeConversationId === null}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white disabled:opacity-40"
            title="Send (Enter)"
          >
            ↑
          </button>
        )}
      </div>
    </div>
  )
}
