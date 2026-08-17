import { useEffect, useRef } from 'react'
import { ArrowLeftIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface SettingsHeaderControlsProps {
  onBack: () => void
}

export function SettingsHeaderControls({ onBack }: SettingsHeaderControlsProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    // App.tsx swaps routes by conditional render with no router - without
    // this, focus lands on <body> on every navigation into Settings.
    headingRef.current?.focus()
  }, [])

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Button variant="ghost" size="sm" onClick={onBack} aria-label="Back to chat" className="text-xs font-medium text-foreground">
        <ArrowLeftIcon /> Back
      </Button>
      <h1 ref={headingRef} tabIndex={-1} className="text-[13px] font-semibold tracking-tight text-foreground outline-none">
        Settings
      </h1>
    </div>
  )
}
