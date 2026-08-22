import type { ReactNode } from 'react'

interface PaneHeaderProps {
  title: string
  description: ReactNode
  children?: ReactNode
}

/** Shared title/description/actions row at the top of every settings pane. */
export function PaneHeader({ title, description, children }: PaneHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  )
}
