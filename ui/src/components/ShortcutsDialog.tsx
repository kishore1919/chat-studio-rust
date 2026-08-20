import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

interface ShortcutsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const SHORTCUTS = [
  { keys: 'Ctrl + ,', description: 'Open Settings' },
  { keys: 'Ctrl + B', description: 'Toggle sidebar' },
  { keys: 'Ctrl + M', description: 'Toggle mind map' },
  { keys: 'Ctrl + /', description: 'Show keyboard shortcuts' },
  { keys: 'Enter', description: 'Send message' },
  { keys: 'Shift + Enter', description: 'New line in composer' },
  { keys: 'Escape', description: 'Stop generation' },
  { keys: '/', description: 'Slash command menu (in composer)' },
] as const

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>Quick reference for all available shortcuts.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1 py-2">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between py-1.5">
              <span className="text-sm text-foreground">{s.description}</span>
              <kbd className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
