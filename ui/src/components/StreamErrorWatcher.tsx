import { useEffect } from 'react'
import { toast } from 'sonner'
import { useChatStore } from '@/store/chat'

export function StreamErrorWatcher() {
  const error = useChatStore((s) => s.error)

  useEffect(() => {
    if (!error) return
    toast.error(error, {
      action: {
        label: 'Dismiss',
        onClick: () => {},
      },
    })
    useChatStore.setState({ error: null })
  }, [error])

  return null
}
