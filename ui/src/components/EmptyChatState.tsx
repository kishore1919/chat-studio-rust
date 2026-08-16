import { useChatStore } from '../store/chat'

const STARTER_PROMPTS = [
  {
    title: 'Explore workspace',
    prompt: 'List the files and directories in the current folder and describe their structure.',
  },
  {
    title: 'Run a shell command',
    prompt: 'Help me run a task using ffmpeg or bash to convert media files in a directory.',
  },
  {
    title: 'Code review',
    prompt: 'Review my recent code changes and suggest clean improvements for performance and UX.',
  },
  {
    title: 'Explain architecture',
    prompt: 'Explain how to architect a high-performance local AI workflow with tool calling.',
  },
]

export function EmptyChatState() {
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const conversations = useChatStore((s) => s.conversations)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const active = conversations.find((c) => c.id === activeConversationId)

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        Chat Studio
      </h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {active?.model
          ? `Ready with ${active.model}. Start typing or choose a prompt.`
          : 'Ready. Start typing below or choose a prompt.'}
      </p>

      <div className="mt-6 grid w-full max-w-lg grid-cols-1 gap-2.5 sm:grid-cols-2 text-left">
        {STARTER_PROMPTS.map((item) => (
          <button
            key={item.title}
            type="button"
            onClick={() => sendMessage(item.prompt)}
            className="flex flex-col items-start gap-1 rounded-lg border border-border/80 bg-card p-3 text-left transition-colors hover:border-border hover:bg-accent/50 cursor-pointer min-w-0"
          >
            <div className="font-medium text-xs text-foreground w-full truncate">
              {item.title}
            </div>
            <div className="text-[11px] text-muted-foreground leading-relaxed whitespace-normal break-words w-full">
              {item.prompt}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
