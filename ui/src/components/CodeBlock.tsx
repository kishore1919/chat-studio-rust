import { useState, type ReactNode } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { cn } from '../lib/utils'

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
  const [copied, setCopied] = useState(false)

  const languageMatch = className?.match(/language-([a-zA-Z0-9_+#.-]+)/)
  const language = languageMatch
    ? languageMatch[1]
    : className?.replace('hljs', '').trim() || 'code'

  const handleCopy = async () => {
    const text = getNodeText(children).replace(/\n$/, '')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="group relative my-3 overflow-hidden rounded-xl border border-border/40 bg-[var(--code-bg)] text-foreground shadow-xs">
      <div className="flex items-center justify-between border-b border-border/30 bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground select-none">
        <span className="font-mono text-[11px] font-semibold lowercase text-primary/90">
          {language}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : 'Copy code'}
          className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Copy code"
        >
          {copied ? (
            <>
              <CheckIcon className="size-3 text-success" />
              <span className="text-success font-medium">Copied</span>
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
