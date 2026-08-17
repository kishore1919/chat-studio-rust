import { useState } from 'react'
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, CopyIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCopyFeedback } from '../lib/useCopyFeedback'

export interface ParsedToolCall {
  id: string
  name: string
  params: Record<string, string>
  raw: string
}

interface ToolCallCardProps {
  toolCall: ParsedToolCall
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [copied, copy] = useCopyFeedback(2000)

  const mainParam = toolCall.params.command || toolCall.params.description || Object.values(toolCall.params)[0] || ''

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    copy(toolCall.params.command || JSON.stringify(toolCall.params, null, 2))
  }

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border bg-muted/40 text-xs transition-colors">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left font-mono transition-colors hover:bg-muted/60"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-sans font-medium text-muted-foreground uppercase">
            tool
          </span>
          <span className="font-semibold text-foreground">{toolCall.name}</span>
          {mainParam && (
            <span className="truncate text-muted-foreground font-normal">
              {mainParam}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={handleCopy}
            title="Copy"
          >
            {copied ? <CheckIcon className="size-3 text-success" /> : <CopyIcon className="size-3" />}
          </Button>
          {expanded ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/60 bg-card p-3 font-mono">
          {Object.entries(toolCall.params).map(([key, val]) => (
            <div key={key} className="mb-2 last:mb-0">
              <div className="mb-1 text-[11px] font-semibold text-muted-foreground uppercase">{key}:</div>
              <pre className="overflow-x-auto rounded bg-muted/70 p-2 text-[12px] leading-relaxed text-foreground whitespace-pre-wrap break-all">
                {val}
              </pre>
            </div>
          ))}
          {Object.keys(toolCall.params).length === 0 && (
            <pre className="overflow-x-auto rounded bg-muted/70 p-2 text-[12px] whitespace-pre-wrap break-all">
              {toolCall.raw}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

/** Utility to extract tool call tags from LLM outputs such as:
 * <tool_call> <function=Bash> <parameter=command> ls </parameter> </tool_call>
 * or <atem:invoke ...> ... </atem:invoke>
 */
export function extractToolCalls(rawText: string): { toolCalls: ParsedToolCall[]; cleanedText: string } {
  const toolCalls: ParsedToolCall[] = []
  let cleanedText = rawText

  const toolCallRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi
  cleanedText = cleanedText.replace(toolCallRegex, (match, inner) => {
    let fnName = 'Tool'
    const fnMatch = inner.match(/<function=([^>]+)>/i)
    if (fnMatch) fnName = fnMatch[1].trim()

    const params: Record<string, string> = {}
    const paramRegex = /<parameter=([^>]+)>([\s\S]*?)(?:<\/parameter>|(?=<parameter=|$))/gi
    let pMatch: RegExpExecArray | null
    while ((pMatch = paramRegex.exec(inner)) !== null) {
      params[pMatch[1].trim()] = pMatch[2].trim()
    }

    if (Object.keys(params).length === 0) {
      const stripped = inner.replace(/<function=[^>]+>/i, '').trim()
      if (stripped) params.input = stripped
    }

    toolCalls.push({
      // Position + name, not Math.random(): these ids are React keys, so a
      // random one made every re-parse of the message remount the card and
      // discard its expanded state. Position is stable for a given body.
      id: `${toolCalls.length}-${fnName}`,
      name: fnName,
      params,
      raw: match,
    })
    return `\n%%TOOL_CALL_${toolCalls.length - 1}%%\n`
  })

  const atemRegex = /<atem:function_calls>[\s\S]*?<\/atem:function_calls>|<atem:invoke[^>]*>[\s\S]*?<\/atem:invoke>/gi
  cleanedText = cleanedText.replace(atemRegex, (match) => {
    let fnName = 'Function'
    const nameMatch = match.match(/name="([^"]+)"|<function=([^>]+)>/i)
    if (nameMatch) fnName = nameMatch[1] || nameMatch[2]

    const params: Record<string, string> = {}
    const paramRegex = /<atem:parameter name="([^"]+)">([\s\S]*?)<\/atem:parameter>/gi
    let pMatch: RegExpExecArray | null
    while ((pMatch = paramRegex.exec(match)) !== null) {
      params[pMatch[1].trim()] = pMatch[2].trim()
    }

    if (Object.keys(params).length === 0) {
      params.data = match.replace(/<\/?atem:[^>]+>/g, '').trim()
    }

    toolCalls.push({
      id: `${toolCalls.length}-${fnName}`,
      name: fnName,
      params,
      raw: match,
    })
    return `\n%%TOOL_CALL_${toolCalls.length - 1}%%\n`
  })

  cleanedText = cleanedText.replace(/<\/?atem:[^>]+>/gi, '').trim()

  return { toolCalls, cleanedText }
}
