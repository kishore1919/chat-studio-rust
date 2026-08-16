import { memo, useMemo, useState, type KeyboardEvent } from 'react'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  PencilIcon,
  RotateCcwIcon,
  SendIcon,
  Trash2Icon,
} from 'lucide-react'
import type { Message } from '../lib/types'
import { MarkdownContent } from './MarkdownContent'
import { ToolCallCard, extractToolCalls } from './ToolCallCard'
import { ThinkingBar, extractThinking } from './ThinkingBar'
import { useChatStore } from '../store/chat'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface MessageBubbleProps {
  message: Message
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

function MessageBubbleImpl({ message }: MessageBubbleProps) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const [copied, setCopied] = useState(false)

  const editAndResendMessage = useChatStore((s) => s.editAndResendMessage)
  const deleteMessage = useChatStore((s) => s.deleteMessage)
  const retryMessage = useChatStore((s) => s.retryMessage)
  const isStreaming = useChatStore((s) => s.streaming !== null)

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

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const startEdit = () => {
    setDraft(message.content)
    setEditing(true)
  }

  const commitEdit = () => {
    if (draft.trim() && !isStreaming) {
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

  const actions = (
    <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-6 text-muted-foreground hover:text-foreground"
        title="Copy"
        onClick={handleCopy}
      >
        {copied ? <CheckIcon className="size-3 text-success" /> : <CopyIcon className="size-3" />}
      </Button>
      {message.role === 'user' && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6 text-muted-foreground hover:text-foreground"
          title="Retry / Regenerate"
          disabled={isStreaming}
          onClick={() => retryMessage(message)}
        >
          <RotateCcwIcon className="size-3" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-6 text-muted-foreground hover:text-foreground"
        title="Edit & Resend"
        disabled={isStreaming}
        onClick={startEdit}
      >
        <PencilIcon className="size-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-6 text-muted-foreground hover:text-destructive"
        title="Delete"
        onClick={() => deleteMessage(message)}
      >
        <Trash2Icon className="size-3" />
      </Button>
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
          disabled={!draft.trim() || isStreaming}
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
      <div className="group flex justify-end px-4 py-2">
        <div className="max-w-[80%] min-w-0">
          {editing ? (
            editBox
          ) : (
            <div className="rounded-2xl rounded-tr-xs bg-[var(--bubble-user)] px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap break-words border border-primary/15 shadow-xs">
              {message.content}
            </div>
          )}
          <div className="flex justify-end">{!editing && actions}</div>
        </div>
      </div>
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
    <div className="group flex justify-start px-4 py-2">
      <div className="max-w-[92%] min-w-0">
        <div className="rounded-2xl rounded-tl-xs bg-[var(--bubble-assistant)] border border-border/70 px-4 py-3 shadow-xs">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
            <span className="font-semibold text-foreground">Assistant</span>
            {message.model && (
              <span className="rounded-md bg-muted/80 px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
                {message.model}
              </span>
            )}
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

          {reasoning && (
            <ThinkingBar reasoning={reasoning} durationMs={message.duration_ms} />
          )}

          {editing ? editBox : renderAssistantContent()}
        </div>
        <div className="flex justify-start">{!editing && actions}</div>
      </div>
    </div>
  )
}

export const MessageBubble = memo(MessageBubbleImpl)
