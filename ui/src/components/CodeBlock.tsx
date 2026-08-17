import { type ReactNode, useMemo } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { cn } from '../lib/utils'
import { useCopyFeedback } from '../lib/useCopyFeedback'

interface CodeBlockProps {
  className?: string
  children: ReactNode
  showLineNumbers?: boolean
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

export function CodeBlock({ className, children, showLineNumbers = true }: CodeBlockProps) {
  const [copied, copy] = useCopyFeedback()

  const languageMatch = className?.match(/language-([a-zA-Z0-9_+#.-]+)/)
  const language = (languageMatch ? languageMatch[1] : className?.replace('hljs', '').trim()) || 'code'

  const rawText = useMemo(() => getNodeText(children).replace(/\n$/, ''), [children])
  const lineCount = useMemo(() => rawText.split('\n').length, [rawText])

  const handleCopy = () => copy(rawText)

  return (
    <div className="group relative my-4 overflow-hidden rounded-xl border border-neutral-800/80 bg-[#121417] shadow-lg">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-neutral-800/80 bg-[#181b20] px-4 py-2 text-xs select-none">
        <span className="font-mono text-xs font-semibold tracking-wider text-neutral-400 uppercase">
          {language}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : 'Copy code'}
          className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
          title="Copy code"
        >
          {copied ? (
            <>
              <CheckIcon className="size-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <CopyIcon className="size-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code with Line Numbers */}
      <div className="flex overflow-x-auto p-4 text-[13px] leading-6 font-mono">
        {showLineNumbers && (
          <div className="flex flex-col select-none pr-4 text-right text-neutral-600">
            {Array.from({ length: lineCount }, (_, i) => (
              <span key={i + 1}>{i + 1}</span>
            ))}
          </div>
        )}
        <pre className="flex-1 bg-transparent p-0">
          <code className={cn('block bg-transparent', className)}>{children}</code>
        </pre>
      </div>
    </div>
  )
}