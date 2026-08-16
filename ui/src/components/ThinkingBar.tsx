import { useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'

interface ThinkingBarProps {
  reasoning: string
  isStreaming?: boolean
  durationMs?: number | null
}

function formatDuration(ms: number | null | undefined) {
  if (!ms) return null
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function ThinkingBar({ reasoning, isStreaming = false, durationMs }: ThinkingBarProps) {
  const [open, setOpen] = useState(isStreaming)
  const duration = formatDuration(durationMs)

  if (!reasoning && !isStreaming) return null

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border/80 bg-muted/30 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-muted-foreground hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2 font-medium">
          {isStreaming ? (
            <span className="flex items-center gap-1.5 text-primary">
              <span className="size-1.5 animate-ping rounded-full bg-primary" />
              <span>Thinking...</span>
            </span>
          ) : (
            <span className="text-foreground">
              {duration ? `Thought for ${duration}` : 'Reasoning Process'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-[11px]">
          <span>{open ? 'Hide' : 'Show'}</span>
          {open ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-border/60 bg-card/60 p-3 font-mono text-[12px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words max-h-80 overflow-y-auto">
          {reasoning || (isStreaming ? 'Generating thoughts...' : '')}
        </div>
      )}
    </div>
  )
}

/** Extracts <think>...</think> blocks from content if reasoning is embedded in text */
export function extractThinking(text: string): { reasoning: string | null; cleanedContent: string } {
  let reasoning: string | null = null
  let cleanedContent = text

  const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/i)
  if (thinkMatch) {
    reasoning = thinkMatch[1].trim()
    cleanedContent = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  } else if (text.startsWith('<think>')) {
    // In-flight unclosed think tag
    const parts = text.split('<think>')
    if (parts.length > 1) {
      reasoning = parts[1].trim()
      cleanedContent = ''
    }
  }

  return { reasoning, cleanedContent }
}
