import { Component, type ReactNode } from 'react'
import { CopyIcon } from 'lucide-react'

interface Props {
  /** Raw text to show if rendering throws - what the reader would have seen
   * had markdown/mermaid/table rendering not crashed the subtree, so a
   * pathological render never costs the user the reply itself. */
  fallbackText: string
  children: ReactNode
}

interface State {
  hasError: boolean
  copied: boolean
}

/** Catches render-time crashes from a single message (a malformed table, a
 * pathological tool-call extraction, an uncaught mermaid throw) so they don't
 * white-screen the whole window. There is no router to recover with anywhere
 * in the app, so this is the only safety net between "one bad message" and
 * "the app is gone until relaunch". */
export class MessageErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, copied: false }
  private copiedTimer: ReturnType<typeof setTimeout> | undefined

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('message render failed', error, info)
  }

  componentWillUnmount() {
    clearTimeout(this.copiedTimer)
  }

  private handleCopy = () => {
    void navigator.clipboard.writeText(this.props.fallbackText)
    this.setState({ copied: true })
    clearTimeout(this.copiedTimer)
    this.copiedTimer = setTimeout(() => this.setState({ copied: false }), 1500)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-destructive">This message failed to render</span>
          <button
            type="button"
            onClick={this.handleCopy}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <CopyIcon className="size-3" />
            {this.state.copied ? 'Copied' : 'Copy raw text'}
          </button>
        </div>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[12px] text-foreground/80">
          {this.props.fallbackText}
        </pre>
      </div>
    )
  }
}
