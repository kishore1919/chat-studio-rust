import { useState, type ReactNode } from 'react'

interface CodeBlockProps {
  className?: string
  children: ReactNode
}

/** Fenced code block renderer used by MarkdownContent, with a copy button. */
export function CodeBlock({ className, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const language = className?.replace('language-', '') ?? ''

  const handleCopy = async () => {
    const text = String(children).replace(/\n$/, '')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="group relative my-2 rounded-lg border border-[var(--border)] bg-[var(--code-bg)]">
      <div className="flex items-center justify-between px-3 py-1.5 text-xs text-[var(--text-muted)]">
        <span>{language}</span>
        <button
          onClick={handleCopy}
          className="rounded px-2 py-0.5 opacity-0 transition-opacity hover:bg-[var(--bg-hover)] group-hover:opacity-100"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 pb-3 text-[13px] leading-relaxed">
        <code className={className}>{children}</code>
      </pre>
    </div>
  )
}
