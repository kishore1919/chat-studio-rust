import { useEffect } from 'react'
import { toast } from 'sonner'
import { useChatStore } from '@/store/chat'

/** Surfaces stream errors (network drop, 401, rate limit, ...) via a sonner
 * toast. Mounted once at the app root rather than per-screen, so an error
 * from Settings' "test connection" flow and one from an in-flight chat
 * stream both funnel through the same place. */
export function StreamErrorWatcher() {
  const error = useChatStore((s) => s.error)

  useEffect(() => {
    if (!error) return
    toast.error(error)
    useChatStore.setState({ error: null })
  }, [error])

  return null
}
