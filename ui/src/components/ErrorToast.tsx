import { useEffect } from 'react'
import { useChatStore } from '../store/chat'

/** Surfaces stream errors (network drop, 401, rate limit, ...) that the
 * chat store records but nothing was previously rendering - a mid-stream
 * failure would otherwise fail silently with the partial message just
 * appearing with no explanation. */
export function ErrorToast() {
  const error = useChatStore((s) => s.error)
  const clearError = () => useChatStore.setState({ error: null })

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(clearError, 6000)
    return () => clearTimeout(timer)
  }, [error])

  if (!error) return null

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-20 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-md items-start gap-2 rounded-lg border border-[var(--danger)]/40 bg-[var(--bg-elevated)] px-3 py-2 text-[13px] shadow-lg">
        <span className="mt-0.5 text-[var(--danger)]">⚠</span>
        <span className="flex-1">{error}</span>
        <button onClick={clearError} className="text-[var(--text-muted)] hover:text-[var(--text)]">
          ✕
        </button>
      </div>
    </div>
  )
}
