import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { CodeBlock } from './CodeBlock'
import { MermaidBlock } from './MermaidBlock'

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
            const isMermaid = className?.includes('language-mermaid') || className === 'mermaid'
            if (isMermaid) {
              return <MermaidBlock chart={String(children)} />
            }
            const isBlock = className?.includes('language-') || (typeof children === 'string' && children.includes('\n'))
            if (isBlock) {
              return <CodeBlock className={className}>{children}</CodeBlock>
            }
            return (
              <code
                className="rounded bg-[var(--code-bg)] px-1.5 py-0.5 font-mono text-[12.5px] text-foreground border border-border/50"
                {...rest}
              >
                {children}
              </code>
            )
          },
          pre({ children }) {
            return <>{children}</>
          },
          table({ children }) {
            return (
              <div className="my-3 overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-xs border-collapse divide-y divide-border">
                  {children}
                </table>
              </div>
            )
          },
          thead({ children }) {
            return <thead className="bg-muted/70">{children}</thead>
          },
          th({ children }) {
            return (
              <th className="border-b border-border px-3 py-2 font-semibold text-foreground">
                {children}
              </th>
            )
          },
          td({ children }) {
            return (
              <td className="border-b border-border/40 px-3 py-2 text-foreground/90">
                {children}
              </td>
            )
          },
          tr({ children }) {
            return <tr className="hover:bg-muted/30 transition-colors">{children}</tr>
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
              >
                {children}
              </a>
            )
          },
          ul({ children }) {
            return <ul className="my-2 list-disc pl-5 space-y-1">{children}</ul>
          },
          ol({ children }) {
            return <ol className="my-2 list-decimal pl-5 space-y-1">{children}</ol>
          },
          li({ children }) {
            return <li className="leading-relaxed pl-0.5">{children}</li>
          },
          p({ children }) {
            return <p className="mb-2.5 last:mb-0 leading-relaxed">{children}</p>
          },
          h1({ children }) {
            return <h1 className="mt-4 mb-2 text-lg font-bold text-foreground first:mt-0">{children}</h1>
          },
          h2({ children }) {
            return <h2 className="mt-3.5 mb-1.5 text-base font-semibold text-foreground first:mt-0">{children}</h2>
          },
          h3({ children }) {
            return <h3 className="mt-3 mb-1 text-sm font-semibold text-foreground first:mt-0">{children}</h3>
          },
          h4({ children }) {
            return <h4 className="mt-2.5 mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground first:mt-0">{children}</h4>
          },
          blockquote({ children }) {
            return (
              <blockquote className="my-2.5 border-l-2 border-primary/70 bg-primary/5 px-3 py-1.5 rounded-r-md text-muted-foreground italic">
                {children}
              </blockquote>
            )
          },
          hr() {
            return <hr className="my-4 border-t border-border" />
          },
          strong({ children }) {
            return <strong className="font-semibold text-foreground">{children}</strong>
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export const MarkdownContent = memo(MarkdownContentImpl)
