import {
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  Trash2Icon,
} from 'lucide-react'
import type { Conversation } from '../lib/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface ConversationRowProps {
  conv: Conversation
  active: boolean
  isSelectMode: boolean
  isSelected: boolean
  onToggleSelect: () => void
  onSelect: () => void
  onRename: () => void
  onTogglePin: () => void
  onDelete: () => void
}

export function ConversationRow({
  conv,
  active,
  isSelectMode,
  isSelected,
  onToggleSelect,
  onSelect,
  onRename,
  onTogglePin,
  onDelete,
}: ConversationRowProps) {
  return (
    <li className="group relative list-none">
      <button
        type="button"
        onClick={isSelectMode ? onToggleSelect : onSelect}
        aria-label={`Open ${conv.title}`}
        aria-current={active ? 'true' : undefined}
        className="absolute inset-0 z-0 rounded-lg"
      />
      <div
        className={cn(
          'pointer-events-none relative z-10 flex items-center justify-between rounded-lg border px-3 py-2 text-[13px] transition-all',
          isSelected
            ? 'border-primary/30 bg-primary/10 font-medium text-foreground'
            : active
              ? 'border-border/40 bg-accent font-medium text-foreground shadow-xs'
              : 'border-transparent text-muted-foreground hover:text-foreground group-hover:border-border/30 group-hover:bg-accent/40',
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isSelectMode && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              className="pointer-events-auto size-3.5 rounded border-border accent-primary cursor-pointer shrink-0"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-foreground leading-snug font-medium text-[13px]">{conv.title}</div>
          </div>
        </div>

        {!isSelectMode && (
          <div className="pointer-events-auto flex shrink-0 items-center gap-1 pl-1">
            {conv.pinned && (
              <PinIcon className="size-3 text-primary opacity-80 group-hover:hidden" />
            )}
            <div className="hidden items-center gap-0.5 group-hover:flex">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onDelete}
                className="size-6 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title="Delete conversation"
              >
                <Trash2Icon className="size-3.5" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-6 text-muted-foreground hover:text-foreground"
                    title="More actions"
                  >
                    <MoreHorizontalIcon className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={onTogglePin}>
                    {conv.pinned ? (
                      <>
                        <PinOffIcon className="size-3.5 mr-1.5" /> Unpin
                      </>
                    ) : (
                      <>
                        <PinIcon className="size-3.5 mr-1.5" /> Pin
                      </>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onRename}>
                    <PencilIcon className="size-3.5 mr-1.5" /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={onDelete}>
                    <Trash2Icon className="size-3.5 mr-1.5" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )}
      </div>
    </li>
  )
}
