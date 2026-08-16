import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUpIcon, LightbulbIcon, SquareIcon } from 'lucide-react'
import { useChatStore } from '../store/chat'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const MIN_TEXTAREA_HEIGHT_PX = 24
const MAX_TEXTAREA_HEIGHT_PX = 180

type ThinkingMode = 'auto' | 'on' | 'off'

interface CommandOption {
  key: string
  label: string
  description: string
  action: (composer: { text: string; setText: (v: string) => void }) => void
}

export function Composer() {
  const [text, setText] = useState('')
  const [menuIndex, setMenuIndex] = useState(0)
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>('auto')
  const sendMessage = useChatStore((s) => s.sendMessage)
  const cancelStream = useChatStore((s) => s.cancelStream)
  const clearConversation = useChatStore((s) => s.clearConversation)
  const isStreaming = useChatStore((s) => s.streaming !== null)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isCommandTriggered = text.startsWith('/')
  const commandQuery = isCommandTriggered ? text.slice(1).toLowerCase() : ''

  const commands: CommandOption[] = [
    {
      key: 'clear',
      label: '/clear',
      description: 'Clear current conversation context',
      action: ({ setText }) => {
        if (activeConversationId !== null) {
          clearConversation(activeConversationId)
        }
        setText('')
      },
    },
    {
      key: 'help',
      label: '/help',
      description: 'Show tips & shortcuts',
      action: ({ setText }) => {
        setText('What are the key features and shortcuts available in Chat Studio?')
      },
    },
    {
      key: 'settings',
      label: '/settings',
      description: 'Open settings',
      action: ({ setText }) => {
        setText('')
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true }))
      },
    },
  ]

  const filteredCommands = isCommandTriggered
    ? commands.filter((c) => c.key.includes(commandQuery))
    : []

  const showCommandMenu = isCommandTriggered && filteredCommands.length > 0

  useEffect(() => {
    setMenuIndex(0)
  }, [commandQuery])

  // Dynamically auto-resize textarea based on exact text content
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = '0px'
    const scrollHeight = el.scrollHeight
    const nextHeight = Math.min(
      Math.max(scrollHeight, MIN_TEXTAREA_HEIGHT_PX),
      MAX_TEXTAREA_HEIGHT_PX,
    )
    el.style.height = `${nextHeight}px`
  }, [text])

  const handleSend = () => {
    const trimmed = text.trim()
    if (!trimmed || isStreaming) return
    setText('')
    const effort = thinkingMode === 'on' ? 'high' : thinkingMode === 'off' ? 'low' : null
    sendMessage(trimmed, effort)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showCommandMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMenuIndex((prev) => (prev + 1) % filteredCommands.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMenuIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const selected = filteredCommands[menuIndex]
        if (selected) {
          selected.action({ text, setText })
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setText('')
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    } else if (e.key === 'Escape' && isStreaming) {
      e.preventDefault()
      cancelStream()
    }
  }

  const thinkingLabels: Record<ThinkingMode, string> = {
    auto: 'Auto',
    on: 'On',
    off: 'Off',
  }

  return (
    <div className="relative border-t border-border p-3">
      {/* Floating Slash Command Autocomplete Menu */}
      {showCommandMenu && (
        <div className="absolute bottom-full left-3 z-30 mb-2 w-64 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-md">
          <div className="px-2 py-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
            Commands
          </div>
          {filteredCommands.map((cmd, idx) => {
            const isSelected = idx === menuIndex
            return (
              <button
                key={cmd.key}
                type="button"
                onClick={() => cmd.action({ text, setText })}
                className={cn(
                  'flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors',
                  isSelected ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-muted text-foreground',
                )}
              >
                <span className="font-mono">{cmd.label}</span>
                <span className="text-[11px] text-muted-foreground">{cmd.description}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Single Unified Input Bar */}
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-card px-3 py-2 shadow-xs transition-colors focus-within:border-primary/50">
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message. Press Enter to send, Shift+Enter for a new line."
          rows={1}
          className={cn(
            'min-h-[24px] max-h-[180px] flex-1 resize-none overflow-y-auto border-0 bg-transparent p-0 text-sm leading-normal shadow-none',
            'focus-visible:ring-0',
          )}
        />

        {/* Thinking Mode Icon Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-full transition-colors cursor-pointer',
                thinkingMode === 'on'
                  ? 'bg-primary/20 text-primary'
                  : thinkingMode === 'off'
                    ? 'text-muted-foreground/40 hover:bg-muted hover:text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              title={`Thinking Mode: ${thinkingLabels[thinkingMode]}`}
            >
              <LightbulbIcon className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44 text-xs">
            <DropdownMenuItem onClick={() => setThinkingMode('auto')}>
              <div className="flex flex-col">
                <span className="font-medium">Auto</span>
                <span className="text-[10px] text-muted-foreground">Model decides reasoning</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setThinkingMode('on')}>
              <div className="flex flex-col">
                <span className="font-medium">Thinking: On</span>
                <span className="text-[10px] text-muted-foreground">Encourages deep reasoning</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setThinkingMode('off')}>
              <div className="flex flex-col">
                <span className="font-medium">Thinking: Off</span>
                <span className="text-[10px] text-muted-foreground">Standard direct output</span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Send / Stop Button */}
        {isStreaming ? (
          <Button
            onClick={cancelStream}
            size="icon"
            variant="destructive"
            className="size-8 shrink-0 rounded-full"
            title="Stop (Esc)"
          >
            <SquareIcon className="size-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            onClick={handleSend}
            disabled={!text.trim()}
            size="icon"
            className="size-8 shrink-0 rounded-full"
            title="Send (Enter)"
          >
            <ArrowUpIcon className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
