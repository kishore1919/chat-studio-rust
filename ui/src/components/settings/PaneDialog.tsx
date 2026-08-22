import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface PaneDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  onSave: () => void
  saveLabel: string
  saveDisabled: boolean
  /** Content rendered between the description and the form fields, e.g. MCP's quick-preset buttons. */
  beforeFields?: ReactNode
  children: ReactNode
}

/** Shared add/edit dialog scaffold used by every settings pane. */
export function PaneDialog({
  open,
  onOpenChange,
  title,
  description,
  onSave,
  saveLabel,
  saveDisabled,
  beforeFields,
  children,
}: PaneDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {beforeFields}

        <div className="space-y-3 pt-1">{children}</div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saveDisabled}>
            {saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
