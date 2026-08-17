import { type ReactNode } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { cn } from '../lib/utils'
import { useCopyFeedback } from '../lib/useCopyFeedback'

interface CodeBlockProps {
  className?: string
  children: ReactNode
}

function getNodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(getNodeText).join('')
  if (
    typeof node === 'object' &&
    'props' in node &&
    (node.props as { children?: ReactNode })?.children
  ) {
    return getNodeText((node.props as { children?: ReactNode }).children)
  }
  return ''
}

/** Fenced code block renderer used by MarkdownContent, with syntax highlighting and copy button. */
export function CodeBlock({ className, children }: CodeBlockProps) {
  const [copied, copy] = useCopyFeedback()

  const languageMatch = className?.match(/language-([a-zA-Z0-9_+#.-]+)/)
  const language = languageMatch
    ? languageMatch[1]
    : className?.replace('hljs', '').trim() || 'code'

  const handleCopy = () => copy(getNodeText(children).replace(/\n$/, ''))

  return (
    // Fixed GitHub Dark colors, not the app's theme tokens - a code block
    // should look the same and stay legible regardless of whether the app
    // itself is in light or dark mode.
    <div
      className="group relative my-3 overflow-hidden rounded-xl border shadow-sm"
      style={{ background: 'var(--code-bg)', borderColor: 'var(--code-border)', color: 'var(--code-fg)' }}
    >
      <div
        className="flex items-center justify-between border-b px-3 py-1.5 text-xs select-none"
        style={{ borderColor: 'var(--code-border)', background: 'var(--code-header-bg)' }}
      >
        <span
          className="font-mono text-[11px] font-semibold lowercase"
          style={{ color: 'var(--hljs-function)' }}
        >
          {language}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : 'Copy code'}
          className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors hover:bg-white/10"
          style={{ color: copied ? 'var(--hljs-tag)' : 'var(--code-muted)' }}
          title="Copy code"
        >
          {copied ? (
            <>
              <CheckIcon className="size-3" />
              <span className="font-medium">Copied</span>
            </>
          ) : (
            <>
              <CopyIcon className="size-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="hljs overflow-x-auto p-3.5 text-[13px] leading-relaxed font-mono bg-transparent">
        <code className={cn('hljs', className, 'bg-transparent block')}>{children}</code>
      </pre>
    </div>
  )
}
