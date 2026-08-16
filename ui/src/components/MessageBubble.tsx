import { memo, useState } from 'react'
import type { Message } from '../lib/types'
import { MarkdownContent } from './MarkdownContent'
import { useChatStore } from '../store/chat'

interface MessageBubbleProps {
  message: Message
}

function formatDuration(ms: number | null) {
  if (ms === null) return null
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/** Wrapped in React.memo so it never re-renders while a sibling message is
 * streaming - the streaming bubble lives in a separate zustand slice and
 * this component only reads its own `message` prop. */
function MessageBubbleImpl({ message }: MessageBubbleProps) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const editMessage = useChatStore((s) => s.editMessage)
  const deleteMessage = useChatStore((s) => s.deleteMessage)

  const startEdit = () => {
    setDraft(message.content)
    setEditing(true)
  }

  const commitEdit = () => {
    if (draft.trim() && draft !== message.content) {
      editMessage(message, draft.trim())
    }
    setEditing(false)
  }

  const actions = (
    <div className="mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      <button
        onClick={() => navigator.clipboard.writeText(message.content)}
        className="rounded px-1.5 py-0.5 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
      >
        Copy
      </button>
      <button
        onClick={startEdit}
        className="rounded px-1.5 py-0.5 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
      >
        Edit
      </button>
      <button
        onClick={() => deleteMessage(message)}
        className="rounded px-1.5 py-0.5 text-xs text-[var(--danger)] hover:bg-[var(--bg-hover)]"
      >
        Delete
      </button>
    </div>
  )

  const editBox = editing && (
    <div className="mt-1 flex flex-col gap-1.5">
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={Math.min(8, Math.max(2, draft.split('\n').length))}
        className="w-full resize-y rounded-lg border border-[var(--accent)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[13px] outline-none"
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={() => setEditing(false)}
          className="rounded px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
        >
          Cancel
        </button>
        <button
          onClick={commitEdit}
          className="rounded bg-[var(--accent)] px-2 py-1 text-xs text-white"
        >
          Save
        </button>
      </div>
    </div>
  )

  if (message.role === 'user') {
    return (
      <div className="group flex justify-end px-4 py-2">
        <div className="max-w-[75%]">
          {editing ? (
            editBox
          ) : (
            <div className="rounded-2xl bg-[var(--bubble-user)] px-4 py-2 text-[14px] whitespace-pre-wrap break-words">
              {message.content}
            </div>
          )}
          <div className="flex justify-end">{!editing && actions}</div>
        </div>
      </div>
    )
  }

  const duration = formatDuration(message.duration_ms)

  return (
    <div className="group px-4 py-2">
      <div className="mb-1 flex items-center gap-2 text-[13px]">
        <span className="font-semibold">Assistant</span>
        {message.model && <span className="text-[var(--text-muted)]">{message.model}</span>}
        {duration && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            Processed · {duration} {expanded ? '▾' : '›'}
          </button>
        )}
      </div>
      {expanded && (
        <div className="mb-2 rounded-md bg-[var(--bg-elevated)] px-3 py-2 text-[12px] text-[var(--text-muted)]">
          {message.tokens_in ?? '?'} in · {message.tokens_out ?? '?'} out · {duration}
        </div>
      )}
      {editing ? editBox : <MarkdownContent content={message.content} />}
      {!editing && actions}
    </div>
  )
}

export const MessageBubble = memo(MessageBubbleImpl)
