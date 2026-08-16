import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { CodeBlock } from './CodeBlock'

interface MarkdownContentProps {
  content: string
}

/** Full markdown + syntax highlighting render, used only for settled
 * messages. In-flight streaming text renders as plain text instead -
 * re-parsing markdown on every token is unnecessary render cost. */
function MarkdownContentImpl({ content }: MarkdownContentProps) {
  return (
    <div className="prose-chat text-[14px] leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code(props) {
            const { className, children, node: _node, ...rest } = props
            const isBlock = className?.includes('language-') || (children as string)?.includes('\n')
            if (isBlock) {
              return (
                <CodeBlock className={className}>{children}</CodeBlock>
              )
            }
            return (
              <code
                className="rounded bg-[var(--code-bg)] px-1.5 py-0.5 text-[13px]"
                {...rest}
              >
                {children}
              </code>
            )
          },
          pre({ children }) {
            // CodeBlock already renders its own <pre>; avoid double-wrapping.
            return <>{children}</>
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export const MarkdownContent = memo(MarkdownContentImpl)
