import { useEffect, useMemo, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { cn } from '@/lib/utils'

// `getCurrentWindow()` throws outside a Tauri webview - `lib/ipc.ts` already
// imports `@tauri-apps/api` unguarded, so plain-browser `vite dev` is already
// broken; this just fails the same way rather than introducing a new one.
function CaptionButton({
  onClick,
  label,
  danger,
  children,
}: {
  onClick: () => void
  label: string
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-full w-[46px] shrink-0 cursor-default items-center justify-center outline-none transition-colors',
        'text-muted-foreground',
        danger
          ? // Windows 11's close-button red is a fixed OS-convention color, not
            // a theme token - `bg-destructive` maps to `--danger`, a semantic
            // *text* red (pale in dark mode, meant to sit on a neutral
            // background), which reads wrong as an opaque caption-button fill.
            'hover:bg-[#c42b1c] hover:text-white active:bg-[#b2261a] active:text-white/90'
          : 'hover:bg-secondary hover:text-foreground active:bg-secondary/60',
      )}
    >
      {children}
    </button>
  )
}

export function WindowControls() {
  const appWindow = useMemo(() => getCurrentWindow(), [])
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let cancelled = false
    let unlisten: UnlistenFn | undefined
    let frame = 0

    const sync = () => {
      // onResized fires on every frame of a drag-resize - coalesce to one
      // isMaximized() IPC round trip per animation frame rather than one per
      // resize event.
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        void appWindow.isMaximized().then((v) => {
          if (!cancelled) setMaximized(v)
        })
      })
    }

    sync()
    void appWindow.onResized(sync).then((fn) => {
      // The component can unmount before this promise settles.
      if (cancelled) fn()
      else unlisten = fn
    })

    return () => {
      cancelled = true
      if (frame) cancelAnimationFrame(frame)
      unlisten?.()
    }
  }, [appWindow])

  return (
    <div className="flex h-full shrink-0 items-stretch">
      <CaptionButton onClick={() => void appWindow.minimize()} label="Minimize">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </CaptionButton>
      <CaptionButton
        onClick={() => void appWindow.toggleMaximize()}
        label={maximized ? 'Restore' : 'Maximize'}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" strokeWidth="1" />
            <path d="M2.5 2.5V0.5H9.5V7.5H7.5" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </CaptionButton>
      <CaptionButton onClick={() => void appWindow.close()} label="Close" danger>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </CaptionButton>
    </div>
  )
}
