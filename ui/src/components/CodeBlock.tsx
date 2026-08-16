import { useState, type ReactNode } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'

interface CodeBlockProps {
  className?: string
  children: ReactNode
}

/** Fenced code block renderer used by MarkdownContent, with a copy button. */
export function CodeBlock({ className, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const language = className?.replace('language-', '') || 'code'

  const handleCopy = async () => {
    const text = String(children).replace(/\n$/, '')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-border bg-[var(--code-bg)] text-foreground">
      <div className="flex items-center justify-between border-b border-border/50 bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
        <span className="font-mono text-[11px] font-medium lowercase">{language}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition-opacity hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
          title="Copy code"
        >
          {copied ? (
            <>
              <CheckIcon className="size-3 text-success" />
              <span className="text-success">Copied</span>
            </>
          ) : (
            <>
              <CopyIcon className="size-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed font-mono">
        <code className={className}>{children}</code>
      </pre>
    </div>
  )
}
