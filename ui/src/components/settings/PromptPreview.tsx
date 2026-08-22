import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PromptPreviewProps {
  children: ReactNode
  lines?: 2 | 3
}

/** Shared muted/monospace preview box for a saved prompt or system instruction. */
export function PromptPreview({ children, lines = 2 }: PromptPreviewProps) {
  return (
    <div
      className={cn(
        'rounded-lg bg-muted/40 p-2 text-[11px] font-mono text-muted-foreground',
        lines === 3 ? 'line-clamp-3' : 'line-clamp-2',
      )}
    >
      {children}
    </div>
  )
}
