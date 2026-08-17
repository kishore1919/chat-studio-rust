import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Copy-to-clipboard with a transient "copied" flag.
 *
 * The cleanup is the point: message bubbles live inside a virtualized list, so
 * copying and then scrolling away unmounts the component while its reset timer
 * is still pending. Every call site used to open a bare `setTimeout` and leak
 * it.
 */
export function useCopyFeedback(resetAfterMs = 1500): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = useCallback(
    (text: string) => {
      void navigator.clipboard.writeText(text)
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), resetAfterMs)
    },
    [resetAfterMs],
  )

  return [copied, copy]
}
