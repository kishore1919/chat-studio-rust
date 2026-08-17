import { useEffect } from 'react'
import { toast } from 'sonner'
import { useChatStore } from '@/store/chat'
import { ipc } from '@/lib/ipc'

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

  // The backend now degrades instead of aborting when settings or the database
  // can't be read, so the only signal that a launch was degraded is this list.
  // Surfacing it once on mount is what keeps "it's not saving my chats" from
  // being an invisible failure.
  useEffect(() => {
    let cancelled = false
    void ipc
      .getDiagnostics()
      .then((d) => {
        if (cancelled) return
        for (const warning of d.startup_warnings) {
          toast.warning(warning, {
            duration: Infinity,
            action: { label: 'Open logs', onClick: () => void ipc.openLogDir() },
          })
        }
      })
      .catch(() => {
        // Diagnostics are advisory - failing to read them must not surface as
        // yet another error on top of whatever already went wrong.
      })
    return () => {
      cancelled = true
    }
  }, [])

  return null
}
