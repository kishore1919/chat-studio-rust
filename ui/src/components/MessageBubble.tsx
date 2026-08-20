import { memo, useMemo, useState, type KeyboardEvent } from 'react'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  EyeOffIcon,
  PencilIcon,
  PinIcon,
  RotateCcwIcon,
  SendIcon,
  Trash2Icon,
} from 'lucide-react'
import type { Message } from '../lib/types'
import { MarkdownContent } from './MarkdownContent'
import { ToolCallCard, extractToolCalls } from './ToolCallCard'
import { ThinkingBar, extractThinking } from './ThinkingBar'
import { MessageRow } from './MessageRow'
import { isPending, useChatStore } from '../store/chat'
import { useCopyFeedback } from '../lib/useCopyFeedback'
import { cn, TIME_FMT } from '../lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface MessageBubbleProps {
  message: Message
  isLastUserMessage?: boolean
}

function formatDuration(ms: number | null) {
  if (ms === null) return null
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTokensPerSecond(tokensOut: number | null, durationMs: number | null) {
  if (!tokensOut || !durationMs) return null
  const seconds = durationMs / 1000
  if (seconds <= 0) return null
  return (tokensOut / seconds).toFixed(1)
}

function MessageBubbleImpl({ message, isLastUserMessage = false }: MessageBubbleProps) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const [copied, copy] = useCopyFeedback(2000)

  const editAndResendMessage = useChatStore((s) => s.editAndResendMessage)
  const deleteMessage = useChatStore((s) => s.deleteMessage)
  const retryMessage = useChatStore((s) => s.retryMessage)
  const setMessageContextFlag = useChatStore((s) => s.setMessageContextFlag)
  const isStreaming = useChatStore((s) => s.streaming !== null)

  // Optimistically rendered / not-yet-persisted rows carry the PENDING_ID
  // sentinel and the backend rejects mutations against it outright. Gate the
  // mutating actions rather than letting them fail.
  const pending = isPending(message)
  const mutationsDisabled = isStreaming || pending
  const pendingHint = pending ? 'Available after reload' : undefined

  const { reasoning, cleanedAfterThinking } = useMemo(() => {
    if (message.role !== 'assistant') {
      return { reasoning: null, cleanedAfterThinking: message.content }
    }
    if (message.reasoning) {
      return { reasoning: message.reasoning, cleanedAfterThinking: message.content }
    }
    const extracted = extractThinking(message.content)
    return { reasoning: extracted.reasoning, cleanedAfterThinking: extracted.cleanedContent }
  }, [message.content, message.reasoning, message.role])

  const { toolCalls, cleanedText } = useMemo(() => {
    if (message.role === 'assistant') {
      return extractToolCalls(cleanedAfterThinking)
    }
    return { toolCalls: [], cleanedText: message.content }
  }, [cleanedAfterThinking, message.content, message.role])

  const handleCopy = () => copy(message.role === 'assistant' ? cleanedText : message.content)

  const pinned = message.context_flag === 'pinned'
  const excluded = message.context_flag === 'excluded'
  const togglePinned = () => setMessageContextFlag(message, pinned ? 'normal' : 'pinned')
  const toggleExcluded = () => setMessageContextFlag(message, excluded ? 'normal' : 'excluded')

  const startEdit = () => {
    setDraft(message.content)
    setEditing(true)
  }

  const commitEdit = () => {
    if (draft.trim() && !mutationsDisabled) {
      editAndResendMessage(message, draft.trim())
    }
    setEditing(false)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      commitEdit()
    } else if (e.key === 'Escape') {
      setEditing(false)
    }
  }

  const actionButtons = (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-6 text-muted-foreground hover:text-foreground"
        aria-label={copied ? 'Copied' : 'Copy message'}
        title="Copy"
        onClick={handleCopy}
      >
        {copied ? <CheckIcon className="size-3 text-success" /> : <CopyIcon className="size-3" />}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className={cn('size-6', pinned ? 'text-primary' : 'text-muted-foreground hover:text-foreground')}
        aria-label={pinned ? 'Unpin from context' : 'Pin in context'}
        title={pendingHint ?? (pinned ? 'Unpin from context' : 'Always keep in context')}
        disabled={pending}
        onClick={togglePinned}
      >
        <PinIcon className="size-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className={cn('size-6', excluded ? 'text-primary' : 'text-muted-foreground hover:text-foreground')}
        aria-label={excluded ? 'Include in context' : 'Exclude from context'}
        title={pendingHint ?? (excluded ? 'Include in context' : 'Exclude from context')}
        disabled={pending}
        onClick={toggleExcluded}
      >
        <EyeOffIcon className="size-3" />
      </Button>
      {message.role === 'user' && isLastUserMessage && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6 text-muted-foreground hover:text-foreground"
          aria-label="Retry message"
          title={pendingHint ?? 'Retry / Regenerate'}
          disabled={mutationsDisabled}
          onClick={() => retryMessage(message)}
        >
          <RotateCcwIcon className="size-3" />
        </Button>
      )}
      {(message.role !== 'user' || isLastUserMessage) && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6 text-muted-foreground hover:text-foreground"
          aria-label="Edit and resend"
          title={pendingHint ?? 'Edit & Resend'}
          disabled={mutationsDisabled}
          onClick={startEdit}
        >
          <PencilIcon className="size-3" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-6 text-muted-foreground hover:text-destructive"
        aria-label="Delete message"
        title={pendingHint ?? 'Delete'}
        disabled={pending}
        onClick={() => deleteMessage(message)}
      >
        <Trash2Icon className="size-3" />
      </Button>
    </>
  )

  // Absolutely positioned rather than conditionally rendered: conditional
  // rendering would drop it from the tab order and reflow the row on hover.
  // `pointer-events-none` keeps it from intercepting clicks while invisible;
  // `group-focus-within` (from MessageRow's `group relative`) is what lets
  // Tab reach it without a mouse.
  const actionsRow = (side: 'left' | 'right', timestamp?: string) => (
    <div
      className={cn(
        // Two full literal classes, not `${side}-0` - Tailwind only
        // generates CSS for classes it can find as a complete literal string
        // while scanning the source. `right-0` never appears literally
        // anywhere else in this codebase, so interpolating it here produced
        // a class with no matching CSS rule at all: the row silently had no
        // `right` position and fell back to the left edge.
        'pointer-events-none absolute bottom-0 z-10 flex items-center gap-0.5 rounded-md border border-border/40 bg-card px-0.5 py-0.5 opacity-0 shadow-sm transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
        side === 'right' ? 'right-0' : 'left-0',
      )}
    >
      {timestamp && <span className="px-1 text-[10px] text-muted-foreground">{timestamp}</span>}
      {actionButtons}
    </div>
  )

  const editBox = editing && (
    <div className="mt-1.5 flex flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5">
      <Textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={Math.min(8, Math.max(2, draft.split('\n').length))}
        className="w-full resize-y border-0 bg-transparent p-0 text-[13px] shadow-none focus-visible:ring-0"
      />
      <div className="flex justify-end gap-2 border-t border-border/40 pt-1.5">
        <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={commitEdit}
          disabled={!draft.trim() || mutationsDisabled}
          className="gap-1.5 text-xs font-medium"
        >
          <SendIcon className="size-3.5" />
          <span>Send</span>
        </Button>
      </div>
    </div>
  )

  if (message.role === 'user') {
    return (
      <MessageRow className="pt-1.5 pb-9">
        <div className="flex justify-end min-w-0">
          <div className="max-w-[85%] min-w-0">
            {editing ? (
              editBox
            ) : (
              <div
                className={cn(
                  'flex flex-col items-start min-w-0 max-w-full rounded-2xl rounded-tr-xs bg-[var(--bubble-user)] px-4 py-2.5 text-[length:var(--chat-font-size)] leading-relaxed border border-border/30 shadow-xs',
                  excluded && 'opacity-50',
                )}
              >
                {(pinned || excluded) && <ContextFlagBadge excluded={excluded} />}
                <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] min-w-0 max-w-full">{message.content}</span>
              </div>
            )}
          </div>
        </div>
        {!editing && actionsRow('right', TIME_FMT.format(new Date(message.created_at * 1000)))}
      </MessageRow>
    )
  }

  const duration = formatDuration(message.duration_ms)
  const tokensPerSecond = formatTokensPerSecond(message.tokens_out, message.duration_ms)

  const renderAssistantContent = () => {
    if (toolCalls.length === 0) {
      return <MarkdownContent content={cleanedText} />
    }

    const parts = cleanedText.split(/%%TOOL_CALL_(\d+)%%/g)
    return (
      <div className="space-y-2">
        {parts.map((part, index) => {
          if (index % 2 === 1) {
            const toolIndex = parseInt(part, 10)
            const tool = toolCalls[toolIndex]
            return tool ? <ToolCallCard key={`tool-${tool.id}`} toolCall={tool} /> : null
          }
          if (!part.trim()) return null
          return <MarkdownContent key={`text-${index}`} content={part} />
        })}
      </div>
    )
  }

  return (
    <MessageRow className="pt-2 pb-9">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[12px]">
        <span className="rounded-md bg-primary/15 px-1.5 py-0.5 font-semibold text-primary">Assistant</span>
        {message.model && (
          <span className="rounded-md bg-muted/80 px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
            {message.model}
          </span>
        )}
        <span className="text-[11px] text-muted-foreground">
          {TIME_FMT.format(new Date(message.created_at * 1000))}
        </span>
        {(pinned || excluded) && <ContextFlagBadge excluded={excluded} />}
        {duration && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
          >
            <span>Processed · {duration}</span>
            {expanded ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
          </button>
        )}
      </div>

      {expanded && (
        <div className="mb-2 rounded-lg bg-muted/60 px-3 py-1.5 text-[11px] font-mono text-muted-foreground border border-border/40">
          {message.tokens_in ?? '?'} in · {message.tokens_out ?? '?'} out · {duration}
          {tokensPerSecond && ` · ${tokensPerSecond} tok/s`}
        </div>
      )}

      {reasoning && <ThinkingBar reasoning={reasoning} durationMs={message.duration_ms} />}

      <div className={cn(excluded && 'opacity-50')}>{editing ? editBox : renderAssistantContent()}</div>
      {!editing && actionsRow('left')}
    </MessageRow>
  )
}

function ContextFlagBadge({ excluded }: { excluded: boolean }) {
  if (excluded) {
    return (
      <span className="mb-1 inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        <EyeOffIcon className="size-2.5" /> Not sent
      </span>
    )
  }
  return (
    <span className="mb-1 inline-flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
      <PinIcon className="size-2.5" /> Pinned
    </span>
  )
}

export const MessageBubble = memo(MessageBubbleImpl)
