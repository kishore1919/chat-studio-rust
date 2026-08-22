import { lazy, memo, Suspense, useEffect, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import type { PluggableList } from 'unified'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock'

// mermaid drags in d3, rough.js and cytoscape - together the bulk of the eager
// bundle - and this component sits on the critical chat path, so a static
// import made every chat pay for diagrams it never renders. Loading it at the
// first ```mermaid fence instead keeps that tree out of first paint.
const MermaidBlock = lazy(() =>
  import('./MermaidBlock').then((m) => ({ default: m.MermaidBlock })),
)

interface MarkdownContentProps {
  content: string
  /** Streaming callers disable this for the one unsettled trailing block:
   * highlight.js is the most expensive plugin in the chain and a fence with no
   * closing delimiter yet has nothing to highlight. */
  highlight?: boolean
}

// Hoisted to module scope because react-markdown memoizes on the identity of
// these props. Rebuilding them per render defeated that on every message,
// settled or streaming.
const REMARK_PLUGINS: PluggableList = [remarkGfm]
const REHYPE_NONE: PluggableList = []

// Measured: highlight.js + lowlight's `common` set is ~175KB of the eager
// bundle. Trimming it is not worth attempting - `rehype-highlight` statically
// imports `common` from lowlight, so the plugin's `languages` option only
// changes which grammars get *registered*, not which get bundled (passing an
// explicit set made the bundle 55KB *larger*). lowlight publishes no subpath
// exports either, so there is no clean way to substitute a smaller default.
// Deferring the whole plugin off the eager chat path is the win instead - it
// is loaded once into this module-scoped cache (a stable reference, since
// react-markdown memoizes on `rehypePlugins` identity) and every mount after
// the first renders highlighted immediately with no re-flash.
let rehypePlugins: PluggableList | null = null
let rehypeLoading: Promise<PluggableList> | null = null
const rehypeSubscribers = new Set<() => void>()

function loadRehypeHighlight(): Promise<PluggableList> {
  if (!rehypeLoading) {
    rehypeLoading = import('rehype-highlight').then((m) => {
      rehypePlugins = [m.default]
      for (const notify of rehypeSubscribers) notify()
      return rehypePlugins
    })
  }
  return rehypeLoading
}

const COMPONENTS: Components = {
  code(props) {
    const { className, children, node: _node, ...rest } = props
    const isMermaid = className?.includes('language-mermaid') || className === 'mermaid'
    if (isMermaid) {
      const chart = String(children)
      return (
        // The source is a more useful placeholder than a spinner - it's
        // what the diagram is, just untransformed.
        <Suspense fallback={<CodeBlock className="language-mermaid">{chart}</CodeBlock>}>
          <MermaidBlock chart={chart} />
        </Suspense>
      )
    }
    const isBlock = className?.includes('language-') || (typeof children === 'string' && children.includes('\n'))
    if (isBlock) {
      return <CodeBlock className={className}>{children}</CodeBlock>
    }
    return (
      <code
        className="rounded bg-[var(--code-bg)] px-1.5 py-0.5 font-mono text-[12.5px] text-[var(--code-fg)] border border-[var(--code-border)] break-words [overflow-wrap:anywhere]"
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
}

function MarkdownContentImpl({ content, highlight = true }: MarkdownContentProps) {
  const [loadedPlugins, setLoadedPlugins] = useState(rehypePlugins)

  useEffect(() => {
    if (!highlight || loadedPlugins) return
    const notify = () => setLoadedPlugins(rehypePlugins)
    rehypeSubscribers.add(notify)
    loadRehypeHighlight().then(notify)
    return () => {
      rehypeSubscribers.delete(notify)
    }
  }, [highlight, loadedPlugins])

  return (
    <div className="prose-chat min-w-0 text-[length:var(--chat-font-size)] leading-relaxed break-words [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={highlight && loadedPlugins ? loadedPlugins : REHYPE_NONE}
        components={COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export const MarkdownContent = memo(MarkdownContentImpl)
