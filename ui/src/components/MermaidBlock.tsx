import { useEffect, useId, useRef, useState } from 'react'
import mermaid from 'mermaid'
import {
  CheckIcon,
  Code2Icon,
  CopyIcon,
  EyeIcon,
  RotateCcwIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react'
import { useThemeStore } from '../store/theme'
import { Button } from '@/components/ui/button'

interface MermaidBlockProps {
  chart: string
}

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'loose',
  fontFamily: 'inherit',
})

export function MermaidBlock({ chart }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const uniqueId = useId().replace(/[:]/g, '_')
  const resolvedType = useThemeStore((s) => s.resolved?.meta.type ?? 'dark')

  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [showCode, setShowCode] = useState(false)
  const [copied, setCopied] = useState(false)
  const [zoom, setZoom] = useState(1)

  const cleanChart = chart.trim()

  useEffect(() => {
    let active = true

    const renderChart = async () => {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: resolvedType === 'light' ? 'default' : 'dark',
          securityLevel: 'loose',
          fontFamily: 'inherit',
        })

        const id = `mermaid_${uniqueId}_${Date.now()}`
        const { svg: renderedSvg } = await mermaid.render(id, cleanChart)
        if (active) {
          setSvg(renderedSvg)
          setError(null)
        }
      } catch (err: unknown) {
        if (active) {
          setError(String(err))
          setSvg('')
        }
      }
    }

    renderChart()

    return () => {
      active = false
    }
  }, [cleanChart, resolvedType, uniqueId])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(cleanChart)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.2, 2.5))
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.2, 0.5))
  const handleResetZoom = () => setZoom(1)

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border/40 bg-card shadow-xs transition-colors">
      {/* Header / Actions */}
      <div className="flex items-center justify-between border-b border-border/30 bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5 font-medium">
          <span className="font-mono text-[11px] text-primary">mermaid</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-[11px]">Diagram</span>
        </div>

        <div className="flex items-center gap-1">
          {!showCode && svg && (
            <div className="flex items-center gap-0.5 mr-2">
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6 text-muted-foreground hover:text-foreground"
                title="Zoom Out"
                onClick={handleZoomOut}
              >
                <ZoomOutIcon className="size-3" />
              </Button>
              <span className="font-mono text-[10px] w-8 text-center">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6 text-muted-foreground hover:text-foreground"
                title="Zoom In"
                onClick={handleZoomIn}
              >
                <ZoomInIcon className="size-3" />
              </Button>
              {zoom !== 1 && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-6 text-muted-foreground hover:text-foreground"
                  title="Reset Zoom"
                  onClick={handleResetZoom}
                >
                  <RotateCcwIcon className="size-2.5" />
                </Button>
              )}
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowCode(!showCode)}
            className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {showCode ? (
              <>
                <EyeIcon className="size-3" />
                <span>Preview</span>
              </>
            ) : (
              <>
                <Code2Icon className="size-3" />
                <span>Code</span>
              </>
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
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
          </Button>
        </div>
      </div>

      {/* Content Body */}
      {showCode ? (
        <pre className="overflow-x-auto bg-[var(--code-bg)] p-3 text-[12px] font-mono leading-relaxed text-foreground">
          <code>{cleanChart}</code>
        </pre>
      ) : error ? (
        <div className="p-4 text-xs">
          <div className="mb-2 text-destructive font-medium">Failed to render Mermaid diagram:</div>
          <pre className="overflow-x-auto rounded bg-muted/50 p-2 font-mono text-[11px] text-muted-foreground">
            {cleanChart}
          </pre>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="flex min-h-32 items-center justify-center overflow-x-auto p-4 transition-transform bg-background/50"
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </div>
  )
}
