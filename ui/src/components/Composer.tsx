import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  ArrowUpIcon,
  ChevronDownIcon,
  ClockIcon,
  MessageSquarePlusIcon,
  SlidersHorizontalIcon,
  SquareIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useChatStore, useConversationMessages } from '../store/chat'
import { useSettingsStore } from '../store/settings'
import { ipc } from '../lib/ipc'
import type { ContextUsage, PromptTemplate, Skill } from '../lib/types'
import { FEATURES } from '../lib/features'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn, useDebouncedCallback } from '@/lib/utils'

const MIN_TEXTAREA_HEIGHT_PX = 24
const MAX_TEXTAREA_HEIGHT_PX = 180

type ThinkingMode = 'auto' | 'on' | 'off'

function CheckCircleMark() {
  return <span aria-hidden="true" className="size-2 shrink-0 rounded-full border-2 border-primary" />
}

interface CommandOption {
  key: string
  label: string
  description: string
  action: (composer: { text: string; setText: (v: string) => void }) => void
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const val = tokens / 1_000_000
    return `${val % 1 === 0 ? val : val.toFixed(1)}M`
  }
  if (tokens >= 1_000) {
    const val = tokens / 1_000
    return `${val % 1 === 0 ? val : val.toFixed(1)}K`
  }
  return tokens.toLocaleString()
}

interface ContextPopoverProps {
  usage: ContextUsage
  onCompact: () => void
}

function ContextPopover({ usage, onCompact }: ContextPopoverProps) {
  const ratio = usage.budget_tokens > 0 ? usage.used_tokens / usage.budget_tokens : 0
  const pct = Math.min(100, Math.max(0, ratio * 100))
  const pctFormatted = (pct >= 10 ? pct.toFixed(1) : pct >= 0.1 ? pct.toFixed(1) : pct.toFixed(0)).replace(/\.0$/, '')
  const radius = 7
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (pct / 100) * circumference

  const handleOpenSettings = () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true }))
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Context window: ${pctFormatted}% used`}
          title={`Context window: ${pctFormatted}% used (${usage.used_tokens.toLocaleString()} / ${usage.budget_tokens.toLocaleString()} tokens)`}
          className={cn(
            'flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors',
            'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <svg className="size-4 -rotate-90" viewBox="0 0 20 20">
            <circle
              cx="10"
              cy="10"
              r={radius}
              stroke="currentColor"
              strokeWidth="2.5"
              className="text-muted/40"
              fill="none"
            />
            <circle
              cx="10"
              cy="10"
              r={radius}
              stroke="currentColor"
              strokeWidth="2.5"
              className={cn(
                'transition-all duration-300',
                pct >= 90 ? 'text-destructive' : pct >= 75 ? 'text-amber-500' : 'text-foreground',
              )}
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
            />
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" sideOffset={10} className="w-64 p-4 shadow-xl">
        <div className="flex flex-col gap-3">
          <div className="text-sm font-semibold text-foreground tracking-tight">Context window</div>

          {/* Progress bar */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/80">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                pct >= 90 ? 'bg-destructive' : pct >= 75 ? 'bg-amber-500' : 'bg-foreground',
              )}
              style={{ width: `${Math.max(pct > 0 ? 2 : 0, pct)}%` }}
            />
          </div>

          {/* Stats row */}
          <div className="flex items-center justify-between text-xs font-normal text-foreground">
            <span>
              {formatTokens(usage.used_tokens)} / {formatTokens(usage.budget_tokens)} tokens used
            </span>
            <span className="tabular-nums font-medium">{pctFormatted}%</span>
          </div>

          {usage.dropped_count > 0 && (
            <p className="flex items-start gap-1 text-[11px] text-amber-500">
              <TriangleAlertIcon className="mt-0.5 size-3 shrink-0" />
              <span>
                {usage.dropped_count} earlier message{usage.dropped_count === 1 ? '' : 's'} won't be sent
                {usage.system_tokens > 0
                  ? ` (system prompt: ${formatTokens(usage.system_tokens)})`
                  : ''}
              </span>
            </p>
          )}

          {/* Action row */}
          <div className="flex items-center gap-1.5 pt-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onCompact}
              className="flex-1 h-8 rounded-full bg-muted/60 hover:bg-muted text-xs font-medium text-foreground transition-colors"
            >
              Compact
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={handleOpenSettings}
              className="size-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
              title="Context settings"
            >
              <SlidersHorizontalIcon className="size-3.5" />
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function Composer() {
  const [text, setText] = useState('')
  const [menuIndex, setMenuIndex] = useState(0)
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>('auto')
  const [dragOver, setDragOver] = useState(false)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const cancelStream = useChatStore((s) => s.cancelStream)
  const clearConversation = useChatStore((s) => s.clearConversation)
  const setConversationSystemPrompt = useChatStore((s) => s.setConversationSystemPrompt)
  const createConversation = useChatStore((s) => s.createConversation)
  const isStreaming = useChatStore((s) => s.streaming !== null)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const conversationMessages = useConversationMessages(activeConversationId)
  const userMessages = conversationMessages.filter((m) => m.role === 'user')
  // null = not currently browsing history; otherwise an index into
  // `userMessages`, most-recent-first (0 is the last message sent).
  const historyIndexRef = useRef<number | null>(null)
  const historyDraftRef = useRef('')
  const settings = useSettingsStore((s) => s.settings)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null)

  const refreshContextUsage = useDebouncedCallback((conversationId: number, draft: string) => {
    ipc
      .getContextUsage(conversationId, draft)
      .then(setContextUsage)
      .catch(() => {})
  }, 250)

  useEffect(() => {
    if (activeConversationId === null) {
      setContextUsage(null)
      return
    }
    refreshContextUsage(activeConversationId, text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId, text])

  const handleNewChat = () => {
    if (!settings) return
    const providerId = settings.default_provider ?? settings.providers[0]?.id
    if (!providerId) return
    createConversation(providerId, settings.default_model ?? '')
  }

  const handleCompact = () => {
    if (isStreaming) return
    sendMessage(
      'Please summarize our conversation so far concisely, preserving all key context, decisions, and facts to compact the history.',
      null,
    )
  }

  const isCommandTriggered = text.startsWith('/')
  const commandQuery = isCommandTriggered ? text.slice(1).toLowerCase() : ''

  const skills = FEATURES.skills ? (settings?.skills?.filter((s: Skill) => s.enabled) ?? []) : []

  // Applies the skill's prompt as this conversation's system prompt for real
  // (via `set_conversation_system_prompt`) - it used to just type a label
  // into the textarea. See lib/features.ts.
  const applySkill = (skill: Skill) => {
    if (activeConversationId === null) return
    setConversationSystemPrompt(activeConversationId, skill.system_prompt)
    setText('')
  }

  // "/skill" alone opens a name-picker submenu; "/skill <name>" filters it as
  // the user types, matching the id or the display name.
  const skillMatch = /^\/skill(?:\s+(.*))?$/i.exec(text)
  const isSkillPicking = FEATURES.skills && skillMatch !== null
  const skillQuery = (skillMatch?.[1] ?? '').trim().toLowerCase()

  const skillCommands: CommandOption[] = skills
    .filter((skill: Skill) => {
      if (!skillQuery) return true
      const id = (skill.slash_command || skill.id).toLowerCase()
      return id.includes(skillQuery) || skill.name.toLowerCase().includes(skillQuery)
    })
    .map((skill: Skill) => ({
      key: skill.slash_command || skill.id,
      label: `/skill ${skill.slash_command || skill.id}`,
      description: skill.description,
      action: () => applySkill(skill),
    }))

  const prompts = settings?.prompts ?? []

  // Inserts the saved snippet as the draft message text - unlike a skill,
  // this never touches the conversation's system prompt.
  const applyPrompt = (prompt: PromptTemplate) => {
    setText(prompt.content)
  }

  // "/prompt" alone opens a name-picker submenu; "/prompt <name>" filters it
  // as the user types, matching the id or the display name.
  const promptMatch = /^\/prompt(?:\s+(.*))?$/i.exec(text)
  const isPromptPicking = promptMatch !== null
  const promptQuery = (promptMatch?.[1] ?? '').trim().toLowerCase()

  const promptCommands: CommandOption[] = prompts
    .filter((prompt) => {
      if (!promptQuery) return true
      return (
        prompt.id.toLowerCase().includes(promptQuery) ||
        prompt.name.toLowerCase().includes(promptQuery)
      )
    })
    .map((prompt) => ({
      key: prompt.id,
      label: `/prompt ${prompt.name}`,
      description: prompt.content,
      action: () => applyPrompt(prompt),
    }))

  const topLevelCommands: CommandOption[] = [
    ...(FEATURES.skills
      ? [
          {
            key: 'skill',
            label: '/skill <name>',
            description: "Apply a skill as this conversation's system prompt",
            action: ({ setText }: { setText: (v: string) => void }) => setText('/skill '),
          },
        ]
      : []),
    {
      key: 'prompt',
      label: '/prompt <name>',
      description: 'Insert a saved prompt as your draft message',
      action: ({ setText }) => setText('/prompt '),
    },
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

  const filteredCommands = isSkillPicking
    ? skillCommands
    : isPromptPicking
      ? promptCommands
      : isCommandTriggered
        ? topLevelCommands.filter((c) => c.key.toLowerCase().includes(commandQuery))
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
    historyIndexRef.current = null
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
    } else if (e.key === 'ArrowUp' && (text === '' || historyIndexRef.current !== null)) {
      if (userMessages.length === 0) return
      const nextIndex = historyIndexRef.current === null ? 0 : historyIndexRef.current + 1
      if (nextIndex >= userMessages.length) return
      e.preventDefault()
      if (historyIndexRef.current === null) historyDraftRef.current = text
      historyIndexRef.current = nextIndex
      setText(userMessages[userMessages.length - 1 - nextIndex].content)
    } else if (e.key === 'ArrowDown' && historyIndexRef.current !== null) {
      e.preventDefault()
      const prevIndex = historyIndexRef.current - 1
      if (prevIndex < 0) {
        historyIndexRef.current = null
        setText(historyDraftRef.current)
      } else {
        historyIndexRef.current = prevIndex
        setText(userMessages[userMessages.length - 1 - prevIndex].content)
      }
    }
  }

  const thinkingLabels: Record<ThinkingMode, string> = {
    auto: 'Auto',
    on: 'On',
    off: 'Off',
  }

  return (
    <div
      className={cn(
        'relative p-3 transition-colors',
        dragOver ? 'bg-accent/20' : '',
      )}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
      }}
    >
      {/* Matches the message list's reading column (see MessageRow) instead
          of stretching edge-to-edge, so the input sits the same width as the
          bubbles above it. */}
      <div className="relative mx-auto w-full max-w-[var(--reading-max)]">
        {showCommandMenu ? (
          <div
            role="listbox"
            aria-label="Commands"
            className="absolute bottom-full left-3 z-30 mb-2 w-64 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-md"
          >
            <div className="px-2 py-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
              {isSkillPicking ? 'Skills' : isPromptPicking ? 'Prompts' : 'Commands'}
            </div>
            {filteredCommands.map((cmd, idx) => {
              const isSelected = idx === menuIndex
              return (
                <button
                  key={cmd.key}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => cmd.action({ text, setText })}
                  className={cn(
                    'flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors',
                    isSelected
                      ? 'bg-accent font-medium text-accent-foreground'
                      : 'text-foreground hover:bg-muted',
                  )}
                >
                  <span className="font-mono shrink-0">{cmd.label}</span>
                  <span className="ml-2 max-w-[180px] truncate text-[11px] text-muted-foreground">
                    {cmd.description}
                  </span>
                </button>
              )
            })}
          </div>
        ) : isCommandTriggered ? (
          <div className="absolute bottom-full left-3 z-30 mb-2 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-md">
            {isSkillPicking
              ? `No skills match "${skillQuery}"`
              : isPromptPicking
                ? `No prompts match "${promptQuery}"`
                : `No commands match "${commandQuery}"`}
          </div>
        ) : null}

        <div
          className={cn(
            'flex flex-col gap-2 rounded-2xl border bg-card px-3 py-2.5 shadow-xs transition-colors focus-within:ring-1 focus-within:ring-primary/20',
            dragOver ? 'border-primary/40' : 'border-border/60',
          )}
        >
          <Textarea
            ref={textareaRef}
            id="composer-textarea"
            value={text}
            onChange={(e) => {
              historyIndexRef.current = null
              setText(e.target.value)
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a message. Press Enter to send, Shift+Enter for a new line. Type / for commands."
            rows={1}
            className={cn(
              'min-h-[24px] max-h-[180px] w-full resize-none overflow-y-auto border-0 bg-transparent p-0 text-sm leading-normal shadow-none',
              'focus-visible:ring-0',
            )}
          />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={handleNewChat}
                aria-label="New chat"
                title="New chat"
                className="size-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
              >
                <MessageSquarePlusIcon className="size-4" />
              </Button>

              {contextUsage && contextUsage.budget_tokens > 0 && (
                <ContextPopover usage={contextUsage} onCompact={handleCompact} />
              )}
            </div>

            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Thinking effort: ${thinkingLabels[thinkingMode]}`}
                    className={cn(
                      'flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors',
                      thinkingMode === 'on'
                        ? 'border-primary/40 bg-primary/15 text-primary'
                        : 'border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                    title={`Thinking effort: ${thinkingLabels[thinkingMode]}`}
                  >
                    <ClockIcon className="size-3.5" />
                    <span>{thinkingLabels[thinkingMode]}</span>
                    <ChevronDownIcon className="size-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44 text-xs">
                  <DropdownMenuItem onClick={() => setThinkingMode('off')}>
                    <div className="flex flex-1 flex-col">
                      <span className="font-medium">Off</span>
                      <span className="text-[10px] text-muted-foreground">Standard direct output</span>
                    </div>
                    {thinkingMode === 'off' && <CheckCircleMark />}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setThinkingMode('on')}>
                    <div className="flex flex-1 flex-col">
                      <span className="font-medium">On</span>
                      <span className="text-[10px] text-muted-foreground">Encourages deep reasoning</span>
                    </div>
                    {thinkingMode === 'on' && <CheckCircleMark />}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setThinkingMode('auto')}>
                    <div className="flex flex-1 flex-col">
                      <span className="font-medium">Auto</span>
                      <span className="text-[10px] text-muted-foreground">Model decides reasoning</span>
                    </div>
                    {thinkingMode === 'auto' && <CheckCircleMark />}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {isStreaming ? (
                <Button
                  onClick={cancelStream}
                  size="icon"
                  variant="destructive"
                  aria-label="Stop generating"
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
                  aria-label={text.trim() ? 'Send message' : 'Type a message to send'}
                  className="size-8 shrink-0 rounded-full"
                  title="Send (Enter)"
                >
                  <ArrowUpIcon className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

