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
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden p-6 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 left-1/2 h-64 w-[520px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
      />
      <h2 className="relative text-xl font-semibold tracking-tight text-foreground">Chat Studio</h2>
      <p className="relative mt-1 max-w-md text-sm text-muted-foreground">
        {active?.model
          ? `Ready with ${active.model}. Start typing or choose a prompt.`
          : 'Ready. Start typing below or choose a prompt.'}
      </p>

      <div className="relative mt-6 grid w-full max-w-lg grid-cols-1 gap-2.5 text-left sm:grid-cols-2">
        {STARTER_PROMPTS.map((item) => (
          <button
            key={item.title}
            type="button"
            onClick={() => sendMessage(item.prompt)}
            className="group flex min-w-0 cursor-pointer flex-col items-start gap-1 rounded-lg border border-border/80 bg-card p-3 text-left transition-colors hover:border-primary/20 hover:bg-accent/50"
          >
            <div className="flex w-full items-center justify-between gap-2">
              <span className="truncate text-xs font-medium text-foreground">{item.title}</span>
              <span className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60">
                ›
              </span>
            </div>
            <div className="w-full break-words text-[11px] leading-relaxed whitespace-normal text-muted-foreground">
              {item.prompt}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
