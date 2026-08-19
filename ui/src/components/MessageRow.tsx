import type { ReactNode } from 'react'

interface MessageRowProps {
  children: ReactNode
  className?: string
}

/** Centers every message in a shared reading column instead of letting each
 * bubble size itself against the full window - without this, a short
 * message left a large dead zone while assistant cards varied width per
 * message. `group relative` is what lets the hover action row (see
 * MessageBubble) position itself out of flow via `absolute` without
 * reserving space on every row. */
export function MessageRow({ children, className }: MessageRowProps) {
  return (
    <div className={`group relative mx-auto w-full max-w-[var(--reading-max)] min-w-0 px-4 ${className ?? ''}`}>
      {children}
    </div>
  )
}
