import type { ReactNode } from 'react'
import { WindowControls } from './WindowControls'

interface TitleBarProps {
  children: ReactNode
}

/** Full-width, theme-colored replacement for the native window titlebar
 * (`decorations: false` in tauri.conf.json). One bar spans the whole window
 * so it can sit above the sidebar, which ChatHeader alone never could - see
 * Chat.tsx, where Sidebar is a sibling of ChatHeader's column, not a child.
 *
 * `data-tauri-drag-region="deep"` (not the bare attribute) is required for
 * dragging to work from anywhere in this bar's empty space - Tauri's bare
 * `data-tauri-drag-region` only drags on a direct hit on that exact element,
 * which is why the old ChatHeader's version only dragged from its own
 * padding pixels. "deep" still lets clickable descendants (buttons, Radix
 * triggers, inputs) work normally with no opt-out needed - Tauri's drag
 * script already skips those by tag/role. The one thing that *would* need
 * `data-tauri-drag-region="false"` is a clickable div/span with no
 * button/role/tabindex - none exist in this bar today. */
export function TitleBar({ children }: TitleBarProps) {
  return (
    <header
      data-tauri-drag-region="deep"
      className="relative z-[45] flex h-12 shrink-0 items-center gap-2 border-b border-border/40 bg-sidebar pl-3 select-none"
    >
      <svg
        className="size-4 shrink-0 text-primary"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <rect x="2" y="2" width="20" height="20" rx="5" fill="currentColor" />
        <path
          d="M7 15.5V8.5C7 8 7.3 7.6 7.8 7.4C10.6 6.3 13.4 6.3 16.2 7.4C16.7 7.6 17 8 17 8.5V15.5C17 16 16.7 16.4 16.2 16.6C13.4 17.7 10.6 17.7 7.8 16.6C7.3 16.4 7 16 7 15.5Z"
          stroke="var(--bg-sidebar)"
          strokeWidth="1.3"
        />
      </svg>
      <span className="shrink-0 text-[13px] font-semibold tracking-tight text-foreground">
        Chat Studio
      </span>
      <span className="mx-1 h-4 w-px shrink-0 bg-border/60" aria-hidden="true" />
      <div data-tauri-drag-region="deep" className="flex min-w-0 flex-1 items-center">
        {children}
      </div>
      <WindowControls />
    </header>
  )
}
