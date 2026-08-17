import type { CSSProperties } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useThemeStore } from '@/store/theme'

function Toaster({ ...props }: ToasterProps) {
  const theme = useThemeStore((s) => (s.resolved?.meta.type === 'light' ? 'light' : 'dark'))

  return (
    <Sonner
      theme={theme as 'light' | 'dark'}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
