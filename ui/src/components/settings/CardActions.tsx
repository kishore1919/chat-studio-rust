import { PencilIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface CardActionsProps {
  onEdit: () => void
  onDelete: () => void
  editTitle?: string
  deleteTitle?: string
}

/** Shared edit/delete icon-button pair used by every item card across the settings panes. */
export function CardActions({
  onEdit,
  onDelete,
  editTitle = 'Edit',
  deleteTitle = 'Delete',
}: CardActionsProps) {
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onEdit}
        className="size-7 text-muted-foreground hover:text-foreground"
        title={editTitle}
      >
        <PencilIcon className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onDelete}
        className="size-7 text-muted-foreground hover:text-destructive"
        title={deleteTitle}
      >
        <Trash2Icon className="size-3.5" />
      </Button>
    </>
  )
}
