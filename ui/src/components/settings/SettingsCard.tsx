import type { ReactNode } from 'react'

/** Shared card container used by every item row across the settings panes. */
export function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-xs transition-colors">
      {children}
    </div>
  )
}
