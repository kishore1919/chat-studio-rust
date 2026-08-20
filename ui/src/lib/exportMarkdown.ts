import type { Message } from './types'
import { TIME_FMT } from './utils'

/** Formats a conversation's messages as a Markdown document. */
export function formatConversationMarkdown(
  title: string,
  messages: Message[],
): string {
  const header = `# ${title}\n*Exported from Chat Studio — ${new Date().toLocaleDateString()}*\n`
  const body = messages
    .map((m) => {
      const role = m.role === 'user' ? 'User' : 'Assistant'
      const time = TIME_FMT.format(new Date(m.created_at * 1000))
      const meta = m.model ? ` · ${m.model}` : ''
      return `## ${role} (${time}${meta})\n\n${m.content}`
    })
    .join('\n\n---\n\n')
  return `${header}\n${body}\n`
}
